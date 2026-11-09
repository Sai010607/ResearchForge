"""Literature quality: link builders, identifier verification, conflict-safe merging, unified ranking,
publication types, redirect / broken-link probing, and save-to-project with the new fields.

No network: upstream services are replaced by fixtures shaped like their documented responses.
"""
import httpx
import pytest

from app.services import discovery, linkprobe, literature, ranking, verify
from tests.helpers import VALID, error_code, register

DOI = "10.1000/abc.1"
TITLE = "Interpretable T1-weighted MRI biomarkers for Alzheimer's disease using a 3D CNN on ADNI"


def rec(source, eid, title=TITLE, **kw):
    return {"source": source, "external_id": eid, "doi": None, "pmid": None, "pmcid": None, "title": title, "abstract": None, "year": None,
            "venue": None, "authors": [], "url": None, "cited_by_count": None, "keywords": [], "reference_ids": [], **kw}


def kinds(links):
    return {l["kind"]: l["url"] for l in links}


# =========================================================================== 1. every URL builder
class TestLinkBuilders:
    FULL = {
        "source": "openalex", "external_id": "W1001", "doi": DOI, "pmid": "111", "pmcid": "PMC999", "arxiv_id": "2101.00001",
        "publisher_url": "https://www.nature.com/articles/x", "oa_url": "https://repo.example/paper.pdf",
        "sources": [{"provider": "openalex", "external_id": "W1001"}, {"provider": "europepmc", "external_id": "MED:111"},
                    {"provider": "semanticscholar", "external_id": "a" * 40}],
    }

    def test_every_kind_points_at_its_own_record(self):
        by = kinds(discovery.build_links(self.FULL))
        assert by == {
            "pmc": "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/", "fulltext": "https://repo.example/paper.pdf",
            "publisher": "https://www.nature.com/articles/x", "doi": "https://doi.org/10.1000/abc.1",
            "pubmed": "https://pubmed.ncbi.nlm.nih.gov/111/", "arxiv": "https://arxiv.org/abs/2101.00001",
            "europepmc": "https://europepmc.org/article/MED/111", "openalex": "https://openalex.org/W1001",
            "semanticscholar": f"https://www.semanticscholar.org/paper/{'a' * 40}",
        }

    @pytest.mark.parametrize("bad", ["javascript:alert(1)", "data:text/html,x", "ftp://x/y", "//evil.example/x", "not a url", "https://", ""])
    def test_only_http_urls_from_sources_are_ever_linked(self, bad):
        links = discovery.build_links({"source": "crossref", "external_id": DOI, "doi": DOI, "publisher_url": bad, "oa_url": bad})
        assert [l["kind"] for l in links] == ["doi"]

    @pytest.mark.parametrize("host", [
        "https://pubmed.ncbi.nlm.nih.gov/111/", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/", "https://europepmc.org/article/MED/1",
        "https://arxiv.org/abs/2101.00001", "https://www.semanticscholar.org/paper/x", "https://openalex.org/W1", "https://doi.org/10.1/x",
        "https://www.researchgate.net/publication/1", "https://scholar.google.com/x", "https://core.ac.uk/download/1.pdf"])
    def test_aggregator_and_index_pages_are_never_labelled_publisher(self, host):
        links = discovery.build_links({"source": "openalex", "external_id": "W1", "doi": DOI, "publisher_url": host})
        assert "publisher" not in kinds(links)

    def test_malformed_identifiers_do_not_produce_links(self):
        links = discovery.build_links({"source": "x", "external_id": "y", "pmid": "12ab", "pmcid": "99", "doi": None,
                                       "sources": [{"provider": "openalex", "external_id": "nope"}, {"provider": "europepmc", "external_id": "bad id"},
                                                   {"provider": "semanticscholar", "external_id": "short"}]})
        assert links == []

    def test_doi_is_percent_encoded_so_it_cannot_break_out_of_the_url(self):
        (l,) = discovery.build_links({"source": "crossref", "external_id": "x", "doi": "10.1000/a b#c?d"})
        assert l["url"] == "https://doi.org/10.1000/a%20b%23c%3Fd"

    def test_arxiv_doi_links_to_the_abs_page(self):
        by = kinds(discovery.build_links({"source": "crossref", "external_id": "x", "doi": "10.48550/arxiv.2101.00001"}))
        assert by["arxiv"] == "https://arxiv.org/abs/2101.00001" and by["doi"] == "https://doi.org/10.48550/arxiv.2101.00001"

    def test_springer_record_links_to_its_own_page_and_doi(self):
        p = discovery.parse_springer_record({"doi": "10.1007/s1", "title": "T", "openaccess": "true",
                                             "url": [{"format": "html", "value": "http://link.springer.com/article/10.1007/s1"},
                                                     {"format": "pdf", "value": "http://link.springer.com/content/pdf/10.1007/s1.pdf"}]})
        by = kinds(discovery.build_links(p))
        assert by["doi"] == "https://doi.org/10.1007/s1"
        assert by["fulltext"] == "https://link.springer.com/article/10.1007/s1"  # the source says it is open access; same URL as its publisher page, listed once
        closed = discovery.parse_springer_record({"doi": "10.1007/s3", "title": "T", "openaccess": "false",
                                                  "url": [{"format": "html", "value": "http://link.springer.com/article/10.1007/s3"}]})
        by = kinds(discovery.build_links(closed))
        assert by["publisher"] == "https://link.springer.com/article/10.1007/s3" and "fulltext" not in by

    def test_springer_closed_record_has_no_fulltext_link_and_pdf_is_not_the_publisher_page(self):
        p = discovery.parse_springer_record({"doi": "10.1007/s2", "title": "T", "openaccess": "false",
                                             "url": [{"format": "pdf", "value": "http://link.springer.com/content/pdf/10.1007/s2.pdf"}]})
        assert "fulltext" not in kinds(discovery.build_links(p)) and p["publisher_url"] is None

    def test_openalex_repository_landing_page_is_not_a_publisher_page(self):
        w = {"id": "https://openalex.org/W5", "title": "T", "doi": f"https://doi.org/{DOI}",
             "primary_location": {"landing_page_url": "https://dspace.university.example/handle/1", "source": {"type": "repository", "display_name": "DSpace"}}}
        p = literature.parse_openalex_work(w)
        assert p["publisher_url"] is None
        assert "publisher" not in kinds(discovery.build_links(p))
        j = literature.parse_openalex_work({**w, "primary_location": {"landing_page_url": "https://journal.example/a", "source": {"type": "journal"}}})
        assert j["publisher_url"] == "https://journal.example/a"

    def test_openalex_oa_url_only_when_open_access(self):
        base = {"id": "https://openalex.org/W5", "title": "T"}
        assert literature.parse_openalex_work({**base, "open_access": {"is_oa": True, "oa_url": "https://x.example/p.pdf"}})["oa_url"] == "https://x.example/p.pdf"
        assert literature.parse_openalex_work({**base, "open_access": {"is_oa": False, "oa_url": "https://x.example/p.pdf"}})["oa_url"] is None

    def test_semantic_scholar_open_access_pdf(self):
        p = discovery.parse_s2_paper({"paperId": "a" * 40, "title": "T", "openAccessPdf": {"url": "https://x.example/p.pdf"}, "publicationTypes": ["Review"]})
        assert p["oa_url"] == "https://x.example/p.pdf" and p["pub_types"] == ["Review"]


class TestPrimaryAction:
    def go(self, **kw):
        return discovery.primary_link(discovery.build_links({"source": "openalex", "external_id": "W1", **kw}), kw.get("publication_type"))

    def test_free_full_text_wins_over_the_publisher(self):
        p = self.go(doi=DOI, pmid="1", pmcid="PMC9")
        assert (p["kind"], p["access"], p["url"]) == ("pmc", "full_text", "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/")

    def test_oa_url_beats_doi(self):
        assert self.go(doi=DOI, oa_url="https://x.example/p.pdf")["kind"] == "fulltext"

    def test_doi_then_publisher_then_pubmed_then_europepmc_last(self):
        assert self.go(doi=DOI, publisher_url="https://j.example/a")["kind"] == "doi"
        assert self.go(publisher_url="https://j.example/a")["kind"] == "publisher"
        assert self.go(pmid="1")["access"] == "abstract"
        only_epmc = discovery.primary_link(discovery.build_links({"source": "europepmc", "external_id": "MED:1"}))
        assert only_epmc["kind"] == "europepmc" and only_epmc["access"] == "record"

    def test_europepmc_is_never_chosen_when_anything_better_exists(self):
        links = discovery.build_links({"source": "europepmc", "external_id": "MED:1", "pmid": "1"})
        assert discovery.primary_link(links)["kind"] == "pubmed"

    def test_arxiv_label_depends_on_whether_it_is_a_preprint(self):
        assert self.go(arxiv_id="2101.00001", publication_type="preprint")["label"] == "Read on arXiv"
        assert "preprint copy" in self.go(arxiv_id="2101.00001", doi=DOI, publication_type="journal_article")["label"]

    def test_no_identifiers_no_primary(self):
        assert discovery.primary_link([]) is None


# =========================================================================== 2. dedupe conflicts
class TestMergeConflicts:
    def test_same_doi_different_pmid_is_not_merged_and_is_flagged(self):
        out = discovery.merge_results([rec("openalex", "W1", doi=DOI, pmid="111"), rec("europepmc", "MED:222", doi=DOI, pmid="222")])
        assert len(out) == 2
        for p in out:
            assert p["verification"]["status"] == "conflict"
            assert any(c["id"] == "identifier_conflict" and "PMID" in c["detail"] for c in p["verification"]["checks"])

    def test_same_pmid_different_doi_is_not_merged(self):
        out = discovery.merge_results([rec("pubmed", "5", doi="10.1/a", pmid="5"), rec("europepmc", "MED:5", doi="10.1/b", pmid="5")])
        assert len(out) == 2 and all(p["verification"]["status"] == "conflict" for p in out)

    def test_pmcid_conflict(self):
        out = discovery.merge_results([rec("openalex", "W1", doi=DOI, pmcid="PMC1"), rec("crossref", DOI, doi=DOI, pmcid="PMC2")])
        assert len(out) == 2

    def test_shared_identifier_but_clearly_different_titles_is_not_merged(self):
        out = discovery.merge_results([rec("openalex", "W1", "Deep learning for brain tumour segmentation in MRI", doi=DOI),
                                       rec("crossref", DOI, "A history of Byzantine monetary policy", doi=DOI)])
        assert len(out) == 2 and all(any("different title" in c["detail"] for c in p["verification"]["checks"]) for p in out)

    def test_shared_identifier_but_years_far_apart_is_not_merged(self):
        out = discovery.merge_results([rec("openalex", "W1", doi=DOI, year=2010), rec("crossref", DOI, doi=DOI, year=2023)])
        assert len(out) == 2

    def test_one_year_apart_still_merges_with_an_info_note(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi=DOI, year=2022), rec("crossref", DOI, doi=DOI, year=2023)])
        year = next(c for c in p["verification"]["checks"] if c["id"] == "year")
        assert year["status"] == "info" and p["verification"]["status"] == "cross_checked"

    def test_transitive_chain_cannot_smuggle_a_conflict_in(self):
        # A-B share a DOI, B-C share a PMID, but A and C carry different PMIDs
        out = discovery.merge_results([rec("openalex", "W1", doi=DOI, pmid="1"), rec("crossref", DOI, doi=DOI), rec("pubmed", "2", pmid="2", doi=DOI)])
        pmids = sorted(str(p.get("pmid")) for p in out)
        assert len(out) == 2 and pmids == ["1", "2"]  # never one card claiming both

    def test_preprint_and_journal_version_stay_separate_without_an_alarm(self):
        out = discovery.merge_results([
            rec("arxiv", "2101.00001", arxiv_id="2101.00001", doi="10.1016/j.x.2021.1", pub_types=["preprint"]),
            rec("openalex", "W2", doi="10.48550/arxiv.2101.00001", pub_types=["preprint"]),
        ])
        assert len(out) == 2 and all(p["verification"]["status"] != "conflict" for p in out)

    def test_weak_title_match_with_two_different_dois_is_not_merged(self):
        t = "A sufficiently long identical normalised title"
        out = discovery.merge_results([rec("openalex", "W1", t, doi="10.1/a", year=2020, authors=["Ada Lovelace"]),
                                       rec("europepmc", "MED:1", t, doi="10.1/b", year=2020, authors=["Ada Lovelace"])])
        assert len(out) == 2

    def test_the_merged_record_keeps_every_identifier_and_every_source(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi=DOI), rec("pubmed", "111", doi=DOI, pmid="111", pmcid="PMC9"),
                                        rec("arxiv", "2101.00001", doi=DOI, arxiv_id="2101.00001")])
        assert (p["doi"], p["pmid"], p["pmcid"], p["arxiv_id"]) == (DOI, "111", "PMC9", "2101.00001")
        assert {s["provider"] for s in p["sources"]} == {"openalex", "pubmed", "arxiv"}
        assert {"doi", "pubmed", "pmc", "arxiv", "openalex"} <= set(kinds(p["links"]))

    def test_single_source_is_labelled_single_source_not_verified(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi=DOI)])
        assert p["verification"]["status"] == "single_source"

    def test_author_disagreement_is_a_warning(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi=DOI, authors=["Ada Lovelace"]), rec("crossref", DOI, doi=DOI, authors=["Alan Turing"])])
        assert p["verification"]["status"] == "warning"
        assert any(c["id"] == "first_author" and c["status"] == "warn" for c in p["verification"]["checks"])

    def test_agreeing_sources_are_cross_checked(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi=DOI, year=2023, authors=["Ada Lovelace"]),
                                        rec("crossref", DOI, doi=DOI, year=2023, authors=["Lovelace, Ada"])])
        assert p["verification"]["status"] == "cross_checked" and p["verification"]["sources_agreeing"] == 2

    def test_invalid_identifier_forms_are_flagged(self):
        (p,) = discovery.merge_results([rec("openalex", "W1", doi="not-a-doi")])
        assert p["verification"]["status"] == "conflict"
        (q,) = discovery.merge_results([rec("crossref", "x", doi="10.48550/arxiv.2101.00001", arxiv_id="2202.99999")])
        assert any(c["id"] == "arxiv_doi" for c in q["verification"]["checks"])


# =========================================================================== 3. publication types
class TestPublicationTypes:
    @pytest.mark.parametrize("raw,expected", [
        (["journal-article"], "journal_article"), (["article", "journal-article"], "journal_article"), (["Journal Article"], "journal_article"),
        (["research-article"], "journal_article"), (["JournalArticle"], "journal_article"), (["Article"], "journal_article"),
        (["review"], "review"), (["Journal Article", "Review"], "review"), (["Systematic Review"], "review"), (["Review"], "review"),
        (["proceedings-article"], "conference_paper"), (["article", "proceedings-article"], "conference_paper"), (["Conference"], "conference_paper"),
        (["book-chapter"], "book_chapter"), (["BookSection"], "book_chapter"), (["Chapter"], "book_chapter"), (["reference-entry"], "book_chapter"),
        (["book"], "book"), (["monograph"], "book"), (["edited-book"], "book"), (["Book"], "book"),
        (["preprint"], "preprint"), (["posted-content"], "preprint"), (["source:PPR"], "preprint"), (["article", "preprint"], "preprint"),
        (["editorial"], "other"), (["erratum"], "other"), (["dataset"], "other"), (["dissertation"], "other"),
        ([], "unknown"), (["something-new"], "unknown"),
    ])
    def test_provider_labels_map_to_one_class(self, raw, expected):
        assert verify.classify_publication(raw) == expected

    def test_doi_prefixes_and_arxiv_source_mean_preprint(self):
        assert verify.classify_publication([], "10.48550/arxiv.2101.1") == "preprint"
        assert verify.classify_publication(["article"], "10.1101/2020.01.01.123") == "preprint"
        assert verify.classify_publication([], None, ["arxiv"]) == "preprint"

    def test_chapter_is_never_promoted_to_article(self):
        assert verify.classify_publication(["article", "book-chapter"]) == "book_chapter"

    def test_parsers_supply_the_raw_labels(self):
        cr = discovery.parse_crossref_item({"DOI": DOI, "title": ["T"], "type": "proceedings-article"})
        assert verify.classify_publication(cr["pub_types"]) == "conference_paper"
        ppr = discovery.parse_crossref_item({"DOI": "10.1101/x", "title": ["T"], "type": "posted-content", "subtype": "preprint"})
        assert verify.classify_publication(ppr["pub_types"], ppr["doi"]) == "preprint"
        pm = discovery.parse_pubmed_xml("<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article><ArticleTitle>T</ArticleTitle>"
                                        "<PublicationTypeList><PublicationType>Journal Article</PublicationType><PublicationType>Review</PublicationType>"
                                        "</PublicationTypeList></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>")[0]
        assert verify.classify_publication(pm["pub_types"]) == "review"
        epmc = literature.parse_europepmc_record({"id": "PPR1", "source": "PPR", "title": "T"})
        assert verify.classify_publication(epmc["pub_types"]) == "preprint"
        oa = literature.parse_openalex_work({"id": "https://openalex.org/W1", "title": "T", "type": "article", "type_crossref": "book-chapter"})
        assert verify.classify_publication(oa["pub_types"]) == "book_chapter"
        sp = discovery.parse_springer_record({"doi": "10.1007/b", "title": "T", "contentType": "Chapter"})
        assert verify.classify_publication(sp["pub_types"]) == "book_chapter"
        assert verify.classify_publication(discovery.parse_arxiv_atom(
            '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.00001v1</id><title>T</title></entry></feed>')[0]["pub_types"]) == "preprint"

    def test_springer_meta_v2_space_separated_types_as_returned_by_the_real_api(self):
        def t(**kw):
            return verify.classify_publication(discovery.parse_springer_record({"doi": "10.1007/x", "title": "T", **kw})["pub_types"])
        assert t(contentType="Chapter ConferencePaper", genre="OriginalPaper Proceedings", publicationType="Book") == "conference_paper"
        assert t(contentType="Chapter", genre="OriginalPaper", publicationType="Book") == "book_chapter"  # the host's "Book" is ignored
        assert t(contentType="Article", genre="OriginalPaper", publicationType="Journal") == "journal_article"
        assert t(contentType="Article", genre="ReviewPaper") == "review"
        assert t(contentType="Book") == "book"
        assert t() == "unknown"

    def test_published_version_outranks_its_preprint_copy_when_merged(self):
        (p,) = discovery.merge_results([rec("arxiv", "2101.00001", doi=DOI, arxiv_id="2101.00001", pub_types=["preprint"]),
                                        rec("openalex", "W1", doi=DOI, pub_types=["article", "journal-article"])])
        assert p["publication_type"] == "journal_article" and p["preprint"] is False and "arxiv" in kinds(p["links"])

    def test_preprint_only_group_is_a_preprint(self):
        (p,) = discovery.merge_results([rec("arxiv", "2101.00001", arxiv_id="2101.00001", pub_types=["preprint"]),
                                        rec("semanticscholar", "s" * 40, arxiv_id="2101.00001", pub_types=["JournalArticle"])])
        assert p["publication_type"] == "journal_article"  # S2 says it is a journal article, so it is not reported as only a preprint
        (q,) = discovery.merge_results([rec("arxiv", "2101.00002", arxiv_id="2101.00002", pub_types=["preprint"])])
        assert q["publication_type"] == "preprint" and q["preprint"] is True


# =========================================================================== 4. unified ranking
def paper(title, abstract=None, **kw):
    return {"title": title, "abstract": abstract, "keywords": [], "authors": [], **kw}


class TestRanking:
    def order(self, query, papers, n=3):
        return [p["title"] for p in ranking.rank(query, papers, n_providers=n)]

    def test_exact_title_ranks_first(self):
        ps = [paper("Alzheimer disease MRI review of methods"), paper("Deep learning for Alzheimer MRI biomarkers", "x"), paper("Deep learning")]
        assert self.order("Deep learning for Alzheimer MRI biomarkers", ps)[0] == "Deep learning for Alzheimer MRI biomarkers"

    def test_one_matching_keyword_does_not_rank_highly(self):
        q = "alzheimer MRI biomarkers deep learning"
        ps = [paper("Alzheimer drug trial outcomes", "Phase 3 study", _ranks={"openalex": 1}),
              paper("Deep learning biomarkers from MRI in Alzheimer disease", "We use deep learning on MRI.", _ranks={"openalex": 9})]
        got = ranking.rank(q, ps, n_providers=1)
        assert got[0]["title"].startswith("Deep learning") and got[1]["relevance"] < 0.05 < got[0]["relevance"]

    def test_provider_rank_does_not_override_text_relevance(self):
        q = "graph neural network brain connectivity"
        ps = [paper("Quarterly sales of garden tools", "network of shops", _ranks={"crossref": 1, "openalex": 1}),
              paper("Graph neural network models of brain connectivity", "We study connectivity.", _ranks={"arxiv": 8})]
        assert ranking.rank(q, ps, n_providers=3)[0]["title"].startswith("Graph neural network")

    def test_abbreviations_match_their_expansion_both_ways(self):
        p1 = paper("Magnetic resonance imaging of hippocampal volume")
        p2 = paper("MRI of hippocampal volume")
        assert ranking.rank("MRI hippocampal volume", [p1], n_providers=1)[0]["match"]["terms_found"] == 3
        assert ranking.rank("magnetic resonance imaging hippocampal volume", [p2], n_providers=1)[0]["match"]["terms_found"] == 5

    def test_plural_and_ing_forms_match(self):
        r = ranking.rank("convolutional networks imaging", [paper("A convolutional network for image analysis")], n_providers=1)[0]
        assert r["match"]["terms_found"] == 3

    def test_abstract_evidence_counts_but_less_than_title(self):
        q = "hippocampal atrophy prediction"
        in_title = paper("Hippocampal atrophy prediction in MCI")
        in_abstract = paper("A study of memory", "hippocampal atrophy prediction was evaluated")
        got = ranking.rank(q, [in_abstract, in_title], n_providers=1)
        assert got[0] is not in_abstract and got[0]["title"] == in_title["title"] and got[1]["relevance"] > 0.1

    def test_quoted_phrase_must_appear(self):
        q = '"graph neural network" connectivity'
        with_phrase = paper("A graph neural network for connectivity")
        words_only = paper("Neural network connectivity on a graph")
        got = ranking.rank(q, [words_only, with_phrase], n_providers=1)
        assert got[0]["title"] == with_phrase["title"] and got[1]["match"]["phrase_found"] is False

    def test_author_match_contributes(self):
        q = "lovelace hippocampus"
        a = paper("Hippocampus shape", authors=["Ada Lovelace"])
        b = paper("Hippocampus shape", authors=["Alan Turing"])
        assert ranking.rank(q, [b, a], n_providers=1)[0]["authors"] == ["Ada Lovelace"]

    def test_domain_concepts_in_query_favour_papers_with_the_same_concepts(self):
        q = "ADNI T1-weighted transformer"
        a = paper("Brain age models", "We use the ADNI cohort, T1-weighted scans and a transformer.")
        b = paper("Brain age models", "We use a cohort of mixed scans.")
        got = ranking.rank(q, [b, a], n_providers=1)
        assert got[0]["abstract"] == a["abstract"]

    def test_results_without_abstract_are_scored_on_what_exists_and_not_invented(self):
        r = ranking.rank("alzheimer biomarkers", [paper("Alzheimer biomarkers in blood")], n_providers=1)[0]
        assert r["relevance"] > 0.3 and r["match"]["terms_found"] == 2

    def test_ties_keep_provider_order(self):
        ps = [paper("Same words here", _id=1), paper("Same words here", _id=2), paper("Same words here", _id=3)]
        assert [p["_id"] for p in ranking.rank("same words here", ps, n_providers=1)] == [1, 2, 3]

    def test_consensus_between_providers_is_a_small_tiebreaker(self):
        a = paper("Cortical thickness in autism", _ranks={"openalex": 3})
        b = paper("Cortical thickness in autism", _ranks={"openalex": 3, "pubmed": 3, "crossref": 2})
        assert ranking.rank("cortical thickness autism", [a, b], n_providers=3)[0]["_ranks"].get("pubmed") == 3

    def test_empty_or_stopword_only_query_does_not_crash(self):
        assert ranking.rank("the of and", [paper("The of and")], n_providers=1)
        assert ranking.rank("???", [paper("anything")], n_providers=1)[0]["relevance"] >= 0

    def test_search_orders_all_providers_by_unified_score_not_provider_rank(self, monkeypatch):
        good = rec("crossref", "10.1/good", "Interpretable MRI biomarkers for Alzheimer disease", doi="10.1/good", abstract="MRI biomarkers.")
        bad = [rec("openalex", f"W{i}", f"Unrelated paper number {i} about MRI hardware", doi=f"10.1/bad{i}") for i in range(3)]
        prov = {
            "openalex": discovery.Provider("openalex", "OpenAlex", "general", lambda q, p, n: bad, lambda x: bad[0], "", ""),
            "crossref": discovery.Provider("crossref", "Crossref", "general", lambda q, p, n: [rec("crossref", "10.1/z", "Zzz", doi="10.1/z"), good], lambda x: good, "", ""),
        }
        monkeypatch.setattr(discovery, "BY_ID", prov)
        out = discovery.search_all("interpretable MRI biomarkers Alzheimer disease", ["openalex", "crossref"], 1)
        assert out["results"][0]["title"].startswith("Interpretable MRI biomarkers")
        assert out["total_unique"] == 5 and all("relevance" in r and "match" in r for r in out["results"])
        assert all("_ranks" not in r and "pub_types" not in r for r in out["results"])  # internal fields never leak


# =========================================================================== 5. identifier -> record consistency (deep check)
class FakeRegistries:
    def __init__(self, monkeypatch):
        self.crossref = None  # dict | None -> not found
        self.pubmed = None
        self.arxiv = None
        self.idconv = None
        self.handle = {"responseCode": 1}
        self.down = set()
        monkeypatch.setattr(literature, "http_get_json", self.jget)
        monkeypatch.setattr(literature, "http_get_text", self.tget)

    def jget(self, url, params, headers=None):
        if "crossref" in url:
            if "crossref" in self.down:
                raise literature.LiteratureTimeout("slow")
            if self.crossref is None:
                raise literature.PaperNotFound("nf")
            return {"message": self.crossref}
        if "doi.org/api/handles" in url:
            return self.handle
        if "idconv" in url:
            return self.idconv
        if "esearch" in url:
            return {"esearchresult": {"idlist": []}}
        raise AssertionError(url)

    def tget(self, url, params):
        if "eutils" in url:
            if self.pubmed is None:
                return "<PubmedArticleSet/>"
            return self.pubmed
        return self.arxiv or "<feed xmlns='http://www.w3.org/2005/Atom'/>"


def pm_xml(pmid, title, doi=None, year="2023", last="Lovelace"):
    ids = f'<ArticleId IdType="doi">{doi}</ArticleId>' if doi else ""
    return (f'<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>{pmid}</PMID><Article><Journal><JournalIssue><PubDate><Year>{year}</Year></PubDate></JournalIssue></Journal>'
            f'<ArticleTitle>{title}</ArticleTitle><AuthorList><Author><LastName>{last}</LastName><ForeName>Ada</ForeName></Author></AuthorList></Article></MedlineCitation>'
            f'<PubmedData><ArticleIdList>{ids}</ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>')


CR = {"DOI": DOI, "title": [TITLE], "issued": {"date-parts": [[2023]]}, "author": [{"given": "Ada", "family": "Lovelace"}]}
RECORD = {"title": TITLE, "year": 2023, "authors": ["Ada Lovelace"], "doi": DOI, "pmid": "111", "pmcid": "PMC999", "arxiv_id": None}


def status(res, cid):
    return next(c["status"] for c in res["checks"] if c["id"] == cid)


class TestIdentifierVerification:
    def test_all_identifiers_agree(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.crossref, f.pubmed = CR, pm_xml("111", TITLE, DOI)
        f.idconv = {"records": [{"pmcid": "PMC999", "pmid": "111", "doi": DOI}]}
        res = verify.check_identifiers(RECORD)
        assert res["status"] == "verified" and not [c for c in res["checks"] if c["status"] in ("fail", "warn")]
        assert status(res, "pmcid_pmid") == "pass" and status(res, "doi_title") == "pass" and status(res, "pmid_author") == "pass"

    def test_doi_pointing_at_a_different_paper_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.crossref = {**CR, "title": ["A history of Byzantine monetary policy"]}
        res = verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None})
        assert res["status"] == "conflict" and status(res, "doi_title") == "fail"

    def test_pmid_title_mismatch_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.pubmed = pm_xml("111", "Completely different subject matter entirely here")
        res = verify.check_identifiers({**RECORD, "doi": None, "pmcid": None})
        assert status(res, "pmid_title") == "fail"

    def test_pmcid_mapping_to_another_pmid_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.idconv = {"records": [{"pmcid": "PMC999", "pmid": "424242", "doi": DOI}]}
        res = verify.check_identifiers({**RECORD, "doi": None, "pmid": "111"})
        assert status(res, "pmcid_pmid") == "fail" and res["status"] == "conflict"

    def test_pmcid_mapping_to_another_doi_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.crossref = CR
        f.idconv = {"records": [{"pmcid": "PMC999", "pmid": "111", "doi": "10.9999/other"}]}
        res = verify.check_identifiers({**RECORD, "pmid": None})
        assert status(res, "pmcid_doi") == "fail"

    def test_unknown_pmcid_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.idconv = {"records": [{"pmcid": "PMC999", "status": "error", "errmsg": "invalid article id"}]}
        assert status(verify.check_identifiers({**RECORD, "doi": None, "pmid": None}), "pmcid_exists") == "fail"

    def test_year_and_author_differences(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.crossref = {**CR, "issued": {"date-parts": [[2024]]}, "author": [{"given": "Alan", "family": "Turing"}]}
        res = verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None})
        assert status(res, "doi_year") == "info" and status(res, "doi_author") == "warn" and res["status"] == "warning"
        f.crossref = {**CR, "issued": {"date-parts": [[2015]]}}
        assert status(verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None}), "doi_year") == "warn"

    def test_arxiv_id_is_checked_against_arxiv(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.arxiv = ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.00001v1</id><published>2021-01-01T00:00:00Z</published>'
                   '<title>Graph transformers for brain networks</title><author><name>Grace Hopper</name></author></entry></feed>')
        ok = verify.check_identifiers({"title": "Graph transformers for brain networks", "year": 2021, "authors": ["Grace Hopper"], "arxiv_id": "2101.00001"})
        assert status(ok, "arxiv_title") == "pass"
        bad = verify.check_identifiers({"title": "Something else entirely different", "year": 2021, "authors": [], "arxiv_id": "2101.00001"})
        assert status(bad, "arxiv_title") == "fail"

    def test_unknown_doi_falls_back_to_the_handle_system(self, monkeypatch):
        f = FakeRegistries(monkeypatch)  # Crossref 404 -> e.g. a DataCite DOI
        assert status(verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None}), "doi_exists") == "pass"
        f.handle = {"responseCode": 100}
        res = verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None})
        assert status(res, "doi_exists") == "fail" and res["status"] == "conflict"

    def test_unreachable_registry_is_info_never_a_false_pass(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.down.add("crossref")
        res = verify.check_identifiers({**RECORD, "pmid": None, "pmcid": None})
        assert status(res, "doi_exists") == "info" and res["status"] == "unchecked"

    def test_record_without_identifiers_is_unchecked(self, monkeypatch):
        FakeRegistries(monkeypatch)
        assert verify.check_identifiers({"title": "T", "authors": []})["status"] == "unchecked"

    def test_pubmed_doi_disagreement_fails(self, monkeypatch):
        f = FakeRegistries(monkeypatch)
        f.pubmed = pm_xml("111", TITLE, "10.9999/other")
        res = verify.check_identifiers({**RECORD, "doi": DOI, "pmcid": None})
        assert status(res, "pmid_doi") == "fail"


# =========================================================================== 6. broken and redirected URLs
def client_for(routes):
    def handler(req: httpx.Request) -> httpx.Response:
        r = routes.get(str(req.url))
        if r is None:
            return httpx.Response(404, text="nope")
        return r(req) if callable(r) else r
    return httpx.Client(transport=httpx.MockTransport(handler))


PAGE = f"<html><head><title>{TITLE}</title></head><body><h1>{TITLE}</h1><p>Abstract</p></body></html>"


class TestLinkProbe:
    def test_doi_redirect_to_the_article_page_is_ok(self):
        c = client_for({"https://doi.org/10.1000/abc.1": httpx.Response(302, headers={"location": "https://publisher.example/article/abc"}),
                        "https://publisher.example/article/abc": httpx.Response(200, text=PAGE)})
        r = linkprobe.probe("https://doi.org/10.1000/abc.1", TITLE, c)
        assert r["verdict"] == "ok" and r["redirects"] == 1 and r["final_url"] == "https://publisher.example/article/abc" and r["title_match"] is True

    def test_dead_page_after_redirect(self):
        c = client_for({"https://doi.org/10.1/x": httpx.Response(301, headers={"location": "/gone"})})
        assert linkprobe.probe("https://doi.org/10.1/x", TITLE, c)["verdict"] == "dead"

    def test_redirect_to_generic_homepage_is_flagged(self):
        c = client_for({"https://doi.org/10.1/x": httpx.Response(302, headers={"location": "https://publisher.example/"}),
                        "https://publisher.example/": httpx.Response(200, text="<html><title>Publisher home</title>Welcome</html>")})
        r = linkprobe.probe("https://doi.org/10.1/x", TITLE, c)
        assert r["verdict"] == "generic_redirect" and r["final_url"] == "https://publisher.example/"

    def test_soft_404_served_as_200(self):
        c = client_for({"https://publisher.example/a": httpx.Response(200, text="<html><title>Oops</title><h1>Page not found</h1><p>The page you requested cannot be found.</p></html>")})
        assert linkprobe.probe("https://publisher.example/a", TITLE, c)["verdict"] == "soft_404"

    def test_a_real_article_that_mentions_not_found_is_not_a_soft_404(self):
        body = f"<html><title>{TITLE}</title><body>{TITLE}. In 404 error cases we found nothing.</body></html>"
        assert linkprobe.probe("https://publisher.example/a", TITLE, client_for({"https://publisher.example/a": httpx.Response(200, text=body)}))["verdict"] == "ok"

    @pytest.mark.parametrize("code", [401, 403, 429])
    def test_sites_that_block_scripts_are_not_reported_as_broken(self, code):
        c = client_for({"https://europepmc.org/article/MED/1": httpx.Response(code)})
        r = linkprobe.probe("https://europepmc.org/article/MED/1", TITLE, c)
        assert r["verdict"] == "blocked" and r["status"] == code

    def test_title_missing_from_html_is_unverified_not_ok(self):
        c = client_for({"https://x.example/a": httpx.Response(200, text="<html><title>Loading…</title><div id=root></div></html>")})
        assert linkprobe.probe("https://x.example/a", TITLE, c)["verdict"] == "unverified"

    def test_redirect_loop_and_server_error_and_network_error(self):
        loop = client_for({"https://x.example/a": httpx.Response(302, headers={"location": "https://x.example/a"})})
        assert linkprobe.probe("https://x.example/a", None, loop)["verdict"] == "unreachable"
        assert linkprobe.probe("https://x.example/a", None, client_for({"https://x.example/a": httpx.Response(500)}))["verdict"] == "unreachable"

        def boom(req):
            raise httpx.ConnectError("no route")
        assert linkprobe.probe("https://x.example/a", None, httpx.Client(transport=httpx.MockTransport(boom)))["verdict"] == "unreachable"

    def test_script_and_style_text_is_not_mistaken_for_page_text(self):
        body = f"<html><script>var t='{TITLE}'</script><body>Loading</body></html>"
        assert linkprobe.probe("https://x.example/a", TITLE, client_for({"https://x.example/a": httpx.Response(200, text=body)}))["verdict"] == "unverified"


# =========================================================================== 7. API: fields, verify endpoint, save-to-project
@pytest.fixture()
def api_upstream(monkeypatch):
    oa = {"id": "https://openalex.org/W1001", "doi": f"https://doi.org/{DOI}", "title": TITLE, "publication_year": 2023, "type": "article", "type_crossref": "proceedings-article",
          "cited_by_count": 4, "abstract_inverted_index": {"We": [0], "train": [1], "a": [2], "3D": [3], "CNN": [4]},
          "authorships": [{"author": {"display_name": "Ada Lovelace"}}], "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/111", "pmcid": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC999"},
          "primary_location": {"landing_page_url": "https://journal.example/a", "source": {"type": "journal", "display_name": "NeuroImage"}},
          "open_access": {"is_oa": True, "oa_url": "https://journal.example/a.pdf"}, "keywords": [], "referenced_works": []}
    other = {"id": "https://openalex.org/W1002", "title": "Unrelated gardening paper", "publication_year": 2001, "authorships": [], "primary_location": None}
    f = FakeRegistries(monkeypatch)
    f.crossref, f.pubmed = CR, pm_xml("111", TITLE, DOI)
    f.idconv = {"records": [{"pmcid": "PMC999", "pmid": "111", "doi": DOI}]}
    orig = f.jget

    def jget(url, params, headers=None):
        if "openalex" in url:
            if "W9999" in url:
                raise literature.PaperNotFound("nf")
            return {"results": [other, oa]} if url.endswith("/works") else oa
        return orig(url, params, headers)
    monkeypatch.setattr(literature, "http_get_json", jget)
    return f


def test_search_returns_type_relevance_match_verification_and_primary_link(client, api_upstream):
    register(client)
    body = client.get("/api/literature/search", params={"q": "interpretable MRI biomarkers Alzheimer", "providers": "openalex"}).json()
    top, last = body["results"][0], body["results"][-1]
    assert top["title"] == TITLE and last["title"].startswith("Unrelated")  # ranked by relevance, not provider order
    assert top["publication_type"] == "conference_paper" and top["relevance"] > last["relevance"]
    assert top["match"]["terms_found"] >= 3 and top["verification"]["status"] == "single_source"
    assert top["primary_link"] == {"kind": "pmc", "label": "Read full text (PMC)", "access": "full_text", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/"}
    assert {"pmc", "fulltext", "publisher", "doi", "pubmed", "openalex"} <= {l["kind"] for l in top["links"]}
    assert top["oa_url"] == "https://journal.example/a.pdf" and top["pmcid"] == "PMC999"
    assert body["providers"][0]["requests"] == 0 and "retries" in body["providers"][0]


def test_verify_endpoint(client, api_upstream):
    assert client.get("/api/literature/verify", params={"source": "openalex", "external_id": "W1001"}).status_code in (401, 403)
    register(client)
    r = client.get("/api/literature/verify", params={"source": "openalex", "external_id": "W1001"})
    assert r.status_code == 200 and r.json()["status"] == "verified"
    assert {"doi_title", "pmid_title", "pmcid_pmid"} <= {c["id"] for c in r.json()["checks"]}
    assert client.get("/api/literature/verify", params={"source": "nope", "external_id": "W1001"}).status_code == 422
    assert client.get("/api/literature/verify", params={"source": "openalex", "external_id": "W9999"}).status_code == 404


def test_verify_endpoint_reports_a_conflict(client, api_upstream):
    register(client)
    api_upstream.idconv = {"records": [{"pmcid": "PMC999", "pmid": "7", "doi": DOI}]}
    r = client.get("/api/literature/verify", params={"source": "openalex", "external_id": "W1001"}).json()
    assert r["status"] == "conflict" and any(c["id"] == "pmcid_pmid" and c["status"] == "fail" for c in r["checks"])


def test_save_to_project_stores_type_oa_url_and_rebuilds_the_same_links(client, api_upstream):
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    search = client.get("/api/literature/search", params={"q": "interpretable MRI biomarkers Alzheimer", "providers": "openalex"}).json()["results"][0]
    r = client.post(f"/api/projects/{pid}/papers", json={"source": search["source"], "external_id": search["external_id"]})
    assert r.status_code == 201
    saved = client.get(f"/api/projects/{pid}/papers").json()[0]
    assert saved["publication_type"] == "conference_paper" and saved["oa_url"] == "https://journal.example/a.pdf"
    assert saved["pmcid"] == "PMC999" and saved["doi"] == DOI and saved["pmid"] == "111"
    assert {l["kind"]: l["url"] for l in saved["links"]} == {l["kind"]: l["url"] for l in search["links"] if l["kind"] != "openalex"} | {"openalex": "https://openalex.org/W1001"}
    assert saved["primary_link"]["kind"] == "pmc"
    mine = client.get("/api/papers/mine").json()
    assert mine[0]["publication_type"] == "conference_paper" and mine[0]["primary_link"]["access"] == "full_text"


def test_search_only_fields_are_never_stored(client, api_upstream, db_session=None):
    from app.core.database import SessionLocal
    from app.models import Paper
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"})
    with SessionLocal() as db:
        cols = {c.name for c in Paper.__table__.columns}
        assert "relevance" not in cols and "verification" not in cols and "links" not in cols and "pub_types" not in cols


def test_providers_report_requests_and_retries_for_a_flaky_source(monkeypatch):
    calls = {"n": 0}

    def flaky(url, **kw):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, request=httpx.Request("GET", url))
        return httpx.Response(200, json={"results": []}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", flaky)
    monkeypatch.setattr("app.services.literature.time.sleep", lambda s: None)
    prov = discovery.Provider("openalex", "OpenAlex", "general", literature.search_openalex, literature.fetch_openalex, "", "")
    monkeypatch.setattr(discovery, "BY_ID", {"openalex": prov})
    out = discovery.search_all("alzheimer mri", ["openalex"], 1)
    st = out["providers"][0]
    assert st["ok"] and st["requests"] == 3 and st["retries"] == 2


def test_no_secret_ever_appears_in_provider_errors(client, monkeypatch, settings):
    register(client)
    monkeypatch.setattr(settings, "springer_api_key", "TOP-SECRET-KEY")

    def boom(url, params, headers=None):
        raise literature.LiteratureError("The literature source returned HTTP 500.")
    monkeypatch.setattr(literature, "http_get_json", boom)
    r = client.get("/api/literature/search", params={"q": "alzheimer", "providers": "springer"})
    assert r.status_code == 502 and "TOP-SECRET-KEY" not in r.text
    assert "TOP-SECRET-KEY" not in client.get("/api/literature/providers").text


def test_crossref_search_retries_without_select_when_crossref_answers_400(monkeypatch):
    from app.services import literature
    calls = []

    def fake(url, params, headers=None):
        calls.append(dict(params))
        if "select" in params:
            raise literature.LiteratureError("The literature source returned HTTP 400.")
        return {"message": {"items": [{"DOI": "10.1000/x1", "title": ["Alzheimer biomarkers"], "issued": {"date-parts": [[2024]]}}]}}
    monkeypatch.setattr(literature, "http_get_json", fake)
    out = discovery.search_crossref("alzheimer", 1, 10)
    assert [p["doi"] for p in out] == ["10.1000/x1"] and "select" not in calls[1]
    assert "subtype" not in discovery.CR_SELECT.split(",")
