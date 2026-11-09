"""Multi-provider discovery: Crossref, PubMed, arXiv, Semantic Scholar, registry, dedupe, isolation.

Upstream is replaced by fixtures shaped like each service's documented response.
"""
import httpx
import pytest

from app.services import discovery, literature
from tests.helpers import VALID, error_code, register

DOI = "10.1000/abc.1"
TITLE = "Interpretable T1-weighted MRI biomarkers for Alzheimer's disease using a 3D CNN on ADNI"

OA = {
    "id": "https://openalex.org/W1001", "doi": f"https://doi.org/{DOI}", "title": TITLE, "publication_year": 2023,
    "cited_by_count": 41, "abstract_inverted_index": None, "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
    "primary_location": None, "keywords": [], "referenced_works": [],
}
CROSSREF = {"message": {"items": [
    {"DOI": DOI.upper(), "title": [TITLE], "abstract": "<jats:p>We train a 3D CNN.</jats:p>", "issued": {"date-parts": [[2023, 5]]},
     "container-title": ["NeuroImage"], "is-referenced-by-count": 39, "URL": f"https://doi.org/{DOI}", "subject": ["Neurology"],
     "author": [{"given": "Ada", "family": "Lovelace"}]},
    {"DOI": "10.5555/zzz", "title": ["Crossref only paper about graph neural networks in fMRI connectivity"],
     "issued": {"date-parts": [[2020]]}, "author": [{"name": "Some Consortium"}]},
]}}
PUBMED_XML = """<?xml version="1.0"?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2024//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_240101.dtd">
<PubmedArticleSet>
 <PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><Article>
  <Journal><JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue><Title>NeuroImage</Title></Journal>
  <ArticleTitle>Interpretable T1-weighted MRI biomarkers for Alzheimer's disease using a 3D <i>CNN</i> on ADNI</ArticleTitle>
  <Abstract><AbstractText Label="BACKGROUND">Alzheimer is common.</AbstractText><AbstractText Label="METHODS">We train a CNN.</AbstractText></Abstract>
  <AuthorList><Author><LastName>Lovelace</LastName><ForeName>Ada</ForeName></Author></AuthorList></Article>
  <MeshHeadingList><MeshHeading><DescriptorName>Alzheimer Disease</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation>
  <PubmedData><ArticleIdList><ArticleId IdType="pubmed">111</ArticleId><ArticleId IdType="doi">10.1000/ABC.1</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
 <PubmedArticle><MedlineCitation><PMID>222</PMID><Article>
  <Journal><JournalIssue><PubDate><MedlineDate>2019 Jan-Feb</MedlineDate></PubDate></JournalIssue><Title>Brain</Title></Journal>
  <ArticleTitle>A PubMed only paper on hippocampal volume</ArticleTitle></Article></MedlineCitation><PubmedData><ArticleIdList/></PubmedData></PubmedArticle>
</PubmedArticleSet>"""
ARXIV_XML = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
 <entry><id>http://arxiv.org/abs/2101.00001v2</id><published>2021-01-01T00:00:00Z</published>
  <title>Graph transformers   for brain
   networks</title><summary>  We propose a model. </summary>
  <author><name>Grace Hopper</name></author><category term="cs.LG"/></entry>
</feed>"""
SPRINGER_JSON = {"result": [{"total": "2", "start": "1", "pageLength": "10", "recordsDisplayed": "2"}], "records": [
    {"identifier": f"doi:{DOI}", "url": [{"format": "", "platform": "web", "value": "http://link.springer.com/article/10.1000/abc.1"},
                                          {"format": "pdf", "platform": "web", "value": "http://link.springer.com/content/pdf/10.1000/abc.1.pdf"}],
     "title": TITLE, "creators": [{"creator": "Lovelace, Ada"}], "publicationName": "NeuroImage", "openaccess": "true", "doi": DOI.upper(),
     "publicationDate": "2023-05-01", "abstract": "We train a 3D CNN on ADNI.", "keyword": ["Alzheimer"]},
    {"doi": "10.1007/book", "title": "A record that is kept", "creators": [{"creator": "Hopper"}], "publicationDate": "2019-01-01",
     "url": [{"value": "http://dx.doi.org/10.1007/book"}], "abstract": {"h1": "Abstract", "p": "Structured abstract text."}},
    {"title": "A book without DOI", "isbn": "123"},
]}
S2 = {"data": [
    {"paperId": "a" * 40, "title": TITLE, "abstract": "We train a 3D CNN on ADNI.", "year": 2023, "venue": "NeuroImage",
     "authors": [{"name": "Ada Lovelace"}], "externalIds": {"DOI": DOI, "PubMed": "111"}, "citationCount": 44, "url": "https://s2/a"},
    {"paperId": "b" * 40, "title": "Graph transformers for brain networks", "year": 2021, "authors": [{"name": "Grace Hopper"}],
     "externalIds": {"ArXiv": "2101.00001"}, "citationCount": 3},
]}


@pytest.fixture()
def upstream(monkeypatch):
    state = {"fail": set(), "calls": []}

    def route(url):
        for name, frag in (("openalex", "openalex"), ("crossref", "crossref"), ("pubmed", "ncbi"), ("arxiv", "arxiv"),
                           ("semanticscholar", "semanticscholar"), ("springer", "springernature"), ("europepmc", "ebi.ac.uk")):
            if frag in url:
                return name
        raise AssertionError(url)

    def jget(url, params, headers=None):
        name = route(url)
        state["calls"].append((name, dict(params), headers))
        if name in state["fail"]:
            raise literature.LiteratureError(f"{name} is down")
        if name == "openalex":
            return {"results": [OA]} if url.endswith("/works") else OA
        if name == "crossref":
            return CROSSREF if url.endswith("/works") else {"message": CROSSREF["message"]["items"][0]}
        if name == "pubmed":
            return {"esearchresult": {"idlist": ["111", "222"]}}
        if name == "semanticscholar":
            return S2 if url.endswith("/search") else S2["data"][0]
        if name == "springer":
            return SPRINGER_JSON
        if name == "europepmc":
            return {"resultList": {"result": []}}
        raise AssertionError(url)

    def tget(url, params):
        name = route(url)
        state["calls"].append((name, dict(params), None))
        if name in state["fail"]:
            raise literature.LiteratureError(f"{name} is down")
        return PUBMED_XML if name == "pubmed" else ARXIV_XML

    monkeypatch.setattr(literature, "http_get_json", jget)
    monkeypatch.setattr(literature, "http_get_text", tget)
    return state


# ------------------------------------------------------------------ parsers
def test_crossref_parser():
    p = discovery.parse_crossref_item(CROSSREF["message"]["items"][0])
    assert p["doi"] == DOI and p["abstract"] == "We train a 3D CNN." and p["year"] == 2023
    assert p["authors"] == ["Ada Lovelace"] and p["venue"] == "NeuroImage" and p["external_id"] == DOI
    org = discovery.parse_crossref_item(CROSSREF["message"]["items"][1])
    assert org["authors"] == ["Some Consortium"] and org["abstract"] is None and org["venue"] is None


def test_pubmed_parser_handles_labels_inline_tags_medline_dates_and_missing_doi():
    a, b = discovery.parse_pubmed_xml(PUBMED_XML)
    assert a["pmid"] == "111" and a["doi"] == DOI and a["title"].endswith("3D CNN on ADNI")
    assert a["abstract"] == "Background: Alzheimer is common. Methods: We train a CNN."
    assert a["authors"] == ["Ada Lovelace"] and "Alzheimer Disease" in a["keywords"] and a["cited_by_count"] is None
    assert b["year"] == 2019 and b["doi"] is None and b["abstract"] is None


def test_pubmed_rejects_entity_declarations():
    with pytest.raises(literature.LiteratureError):
        discovery.parse_pubmed_xml('<!DOCTYPE x [<!ENTITY a "b">]><PubmedArticleSet/>')


def test_arxiv_parser_normalises_whitespace_and_strips_version():
    (p,) = discovery.parse_arxiv_atom(ARXIV_XML)
    assert p["external_id"] == "2101.00001" and p["title"] == "Graph transformers for brain networks"
    assert p["abstract"] == "We propose a model." and p["year"] == 2021 and p["venue"] == "arXiv preprint"


def test_semantic_scholar_parser():
    p = discovery.parse_s2_paper(S2["data"][0])
    assert p["doi"] == DOI and p["pmid"] == "111" and p["cited_by_count"] == 44
    assert discovery.parse_s2_paper(S2["data"][1])["arxiv_id"] == "2101.00001"


# ------------------------------------------------------------------ merge
def _rec(source, eid, title, **kw):
    return {"source": source, "external_id": eid, "doi": None, "pmid": None, "title": title, "abstract": None, "year": None,
            "venue": None, "authors": [], "url": None, "cited_by_count": None, "keywords": [], "reference_ids": [], **kw}


def test_merge_by_doi_pmid_and_arxiv_with_provenance_and_gap_filling():
    items = [
        _rec("openalex", "W1", "Paper one title is long enough here", doi=DOI, reference_ids=["W2"]),
        _rec("pubmed", "111", "Paper one title is long enough here", doi=DOI, pmid="111", abstract="From PubMed."),
        _rec("europepmc", "MED:111", "Differently worded title of paper one", pmid="111"),
        _rec("arxiv", "2101.00001", "Preprint A", arxiv_id="2101.00001"),
        _rec("semanticscholar", "s" * 40, "Preprint A (v2)", arxiv_id="2101.00001", cited_by_count=3),
    ]
    out = discovery.merge_results(items)
    assert len(out) == 2
    one, pre = out
    assert one["source"] == "openalex" and one["abstract"] == "From PubMed." and one["pmid"] == "111"  # gap filled
    assert one["reference_ids"] == ["W2"]
    assert {s["provider"] for s in one["sources"]} == {"openalex", "pubmed", "europepmc"}
    assert pre["preprint"] is True and pre["cited_by_count"] == 3 and one["preprint"] is False


def test_title_alone_never_merges_but_title_year_author_does():
    t = "A sufficiently long identical normalised title"
    same_title_only = discovery.merge_results([_rec("openalex", "W1", t), _rec("crossref", "10.1/x", t)])
    assert len(same_title_only) == 2
    different_author = discovery.merge_results([
        _rec("openalex", "W1", t, year=2020, authors=["Ada Lovelace"]), _rec("crossref", "10.1/x", t, year=2020, authors=["Alan Turing"])])
    assert len(different_author) == 2
    same = discovery.merge_results([
        _rec("openalex", "W1", t, year=2020, authors=["Ada Lovelace"]), _rec("europepmc", "MED:1", t.upper() + ".", year=2020, authors=["Lovelace A"])])
    assert len(same) == 1
    other_year = discovery.merge_results([
        _rec("openalex", "W1", t, year=2020, authors=["Ada Lovelace"]), _rec("crossref", "10.1/x", t, year=2021, authors=["Ada Lovelace"])])
    assert len(other_year) == 2


def test_arxiv_doi_links_to_arxiv_record():
    out = discovery.merge_results([
        _rec("crossref", "10.48550/arxiv.2101.00001", "Preprint A", doi="10.48550/arxiv.2101.00001"),
        _rec("arxiv", "2101.00001", "Preprint A", arxiv_id="2101.00001")])
    assert len(out) == 1 and out[0]["preprint"] is True


# ------------------------------------------------------------------ API
def test_providers_endpoint_lists_registry_without_secrets(client, settings, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "semantic_scholar_api_key", "SECRET-KEY-VALUE")
    r = client.get("/api/literature/providers")
    assert r.status_code == 200 and "SECRET-KEY-VALUE" not in r.text
    by = {p["id"]: p for p in r.json()}
    assert set(by) == {"openalex", "pubmed", "europepmc", "crossref", "semanticscholar", "arxiv", "springer"}
    assert by["springer"]["requires_key"] is True and by["springer"]["key_configured"] is False and by["springer"]["default_enabled"] is False
    assert by["semanticscholar"]["key_configured"] is True and by["semanticscholar"]["default_enabled"] is True
    assert by["openalex"]["supports_full_text"] is False and by["pubmed"]["group"] == "biomedical"


def test_default_search_excludes_semantic_scholar_without_a_key(client, upstream):
    register(client)
    r = client.get("/api/literature/search", params={"q": "alzheimer mri"})
    assert r.status_code == 200
    assert [p["provider"] for p in r.json()["providers"]] == ["openalex", "pubmed", "europepmc", "crossref", "arxiv"]


def test_all_providers_dedupe_counts_and_status(client, upstream):
    register(client)
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": ",".join(i for i in discovery.SOURCE_IDS if i != "springer")})
    body = r.json()
    returned = {p["provider"]: p["count"] for p in body["providers"]}
    assert returned == {"openalex": 1, "pubmed": 2, "europepmc": 0, "crossref": 2, "semanticscholar": 2, "arxiv": 1}
    # 8 provider records collapse to 4 unique papers; unique is NOT the sum of provider counts
    assert sum(returned.values()) == 8 and body["total_unique"] == 4 == len(body["results"])
    main = next(p for p in body["results"] if p["doi"] == DOI)
    assert {s["provider"] for s in main["sources"]} == {"openalex", "pubmed", "crossref", "semanticscholar"}
    assert main["pmid"] == "111" and main["preprint"] is False
    pre = next(p for p in body["results"] if p["arxiv_id"] == "2101.00001")
    assert pre["preprint"] is True and {s["provider"] for s in pre["sources"]} == {"arxiv", "semanticscholar"}
    assert all(isinstance(p["duration_ms"], int) for p in body["providers"]) and body["duration_ms"] >= 0


def test_failing_provider_is_isolated_and_reported(client, upstream):
    register(client)
    upstream["fail"].update({"pubmed", "crossref"})
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,pubmed,crossref"})
    body = r.json()
    assert r.status_code == 200 and len(body["results"]) == 1
    st = {p["provider"]: p for p in body["providers"]}
    assert st["openalex"]["ok"] and not st["pubmed"]["ok"] and "pubmed is down" in st["pubmed"]["error"]
    assert len(body["warnings"]) == 2


def test_unexpected_adapter_error_is_isolated(client, upstream, monkeypatch):
    register(client)
    monkeypatch.setitem(discovery.BY_ID, "arxiv", discovery.Provider("arxiv", "arXiv", "cs", lambda q, p, n: 1 / 0, discovery.fetch_arxiv, "", ""))
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,arxiv"})
    st = {p["provider"]: p for p in r.json()["providers"]}
    assert r.status_code == 200 and st["openalex"]["ok"] and st["arxiv"]["error"] == "Unexpected error while reading this source."


def test_all_selected_providers_failing_is_502(client, upstream):
    register(client)
    upstream["fail"].update({"pubmed", "arxiv"})
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "pubmed,arxiv"})
    assert r.status_code == 502 and error_code(r) == "literature_unavailable"


def test_unknown_provider_is_rejected(client, upstream):
    register(client)
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,evil"})
    assert r.status_code == 422 and error_code(r) == "unknown_provider" and upstream["calls"] == []


def test_semantic_scholar_key_is_sent_as_header_only_when_configured(client, upstream, settings, monkeypatch):
    register(client)
    client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "semanticscholar"})
    assert upstream["calls"][-1][2] is None
    monkeypatch.setattr(settings, "semantic_scholar_api_key", "k123")
    client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "semanticscholar"})
    assert upstream["calls"][-1][2] == {"x-api-key": "k123"}


def test_pagination_offsets_are_passed_per_provider(client, upstream):
    register(client)
    client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "crossref,pubmed", "page": 3})
    sent = {c[0]: c[1] for c in upstream["calls"] if c[1].get("offset") is not None or c[1].get("retstart") is not None}
    assert sent["crossref"]["offset"] == 20 and sent["pubmed"]["retstart"] == 20


@pytest.mark.parametrize("source,eid,expect", [
    ("pubmed", "111", "pubmed"), ("crossref", DOI, "crossref"), ("arxiv", "2101.00001", "arxiv"), ("semanticscholar", "a" * 40, "semanticscholar"),
])
def test_save_from_each_new_source_fetches_server_side(client, upstream, source, eid, expect):
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    r = client.post(f"/api/projects/{pid}/papers", json={"source": source, "external_id": eid, "title": "FAKE"})
    assert r.status_code == 201 and r.json()["source"] == expect and r.json()["title"] != "FAKE"
    assert "sources" in r.json()  # response model has the field but it is just empty for saved papers


@pytest.mark.parametrize("source,eid", [("pubmed", "11x"), ("crossref", "not-a-doi"), ("arxiv", "../etc"), ("semanticscholar", "zzz")])
def test_malformed_ids_never_reach_the_network(client, upstream, source, eid):
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    r = client.post(f"/api/projects/{pid}/papers", json={"source": source, "external_id": eid})
    assert r.status_code == 404 and upstream["calls"] == []


def test_same_paper_saved_via_two_providers_is_one_row(client, upstream):
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    client.post(f"/api/projects/{pid}/papers", json={"source": "pubmed", "external_id": "111"})
    client.post(f"/api/projects/{pid}/papers", json={"source": "crossref", "external_id": DOI})
    assert len(client.get(f"/api/projects/{pid}/papers").json()) == 1


# ------------------------------------------------------------------ transport: retries, secrets
def test_transport_retries_429_then_succeeds_and_hides_url(monkeypatch):
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return httpx.Response(429 if len(calls) < 3 else 200, json={"ok": 1}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr("app.services.literature.time.sleep", lambda s: None)
    assert literature.http_get_json("https://example.org/x?api_key=SECRET", {}) == {"ok": 1} and len(calls) == 3

    monkeypatch.setattr(httpx, "get", lambda url, **kw: httpx.Response(503, request=httpx.Request("GET", url)))
    with pytest.raises(literature.LiteratureError) as e:
        literature.http_get_json("https://example.org/x?api_key=SECRET", {})
    assert "SECRET" not in str(e.value) and "503" in str(e.value)


def test_transport_does_not_retry_client_errors(monkeypatch):
    calls = []
    monkeypatch.setattr(httpx, "get", lambda url, **kw: (calls.append(1), httpx.Response(400, request=httpx.Request("GET", url)))[1])
    with pytest.raises(literature.LiteratureError):
        literature.http_get_json("https://example.org/x", {})
    assert len(calls) == 1


# ------------------------------------------------------------------ identifiers + links (point 6/7)
def test_pmcid_is_normalised_from_every_shape():
    n = literature.normalize_pmcid
    assert n("PMC123") == n("pmc123") == n("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/") == n("123") == "PMC123"
    assert n(None) is None and n("") is None and n("abc") is None


def test_identifiers_are_preserved_per_provider():
    a = literature.parse_openalex_work({**OA, "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/111", "pmcid": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC999"},
                                        "primary_location": {"landing_page_url": "https://publisher.example/x"}})
    assert a["pmid"] == "111" and a["pmcid"] == "PMC999" and a["publisher_url"] == "https://publisher.example/x"
    e = literature.parse_europepmc_record({"id": "111", "source": "MED", "pmid": "111", "pmcid": "PMC999", "title": "T", "doi": DOI})
    assert e["pmcid"] == "PMC999"
    xml = PUBMED_XML.replace('<ArticleId IdType="pubmed">111</ArticleId>', '<ArticleId IdType="pubmed">111</ArticleId><ArticleId IdType="pmc">PMC999</ArticleId>')
    assert discovery.parse_pubmed_xml(xml)[0]["pmcid"] == "PMC999"
    cr = discovery.parse_crossref_item({**CROSSREF["message"]["items"][0], "resource": {"primary": {"URL": "https://publisher.example/p"}}})
    assert cr["publisher_url"] == "https://publisher.example/p"
    assert discovery.parse_s2_paper({**S2["data"][0], "externalIds": {"DOI": DOI, "PubMedCentral": "999"}})["pmcid"] == "PMC999"


def test_links_are_built_from_ids_exactly_and_deduplicated():
    links = discovery.build_links({
        "source": "openalex", "external_id": "W1001", "doi": "10.1000/abc.1", "pmid": "111", "pmcid": "PMC999", "arxiv_id": "2101.00001",
        "publisher_url": "https://publisher.example/x",
        "sources": [{"provider": "openalex", "external_id": "W1001"}, {"provider": "europepmc", "external_id": "MED:111"},
                    {"provider": "semanticscholar", "external_id": "a" * 40}],
    })
    by = {link["kind"]: link["url"] for link in links}
    assert by == {
        "publisher": "https://publisher.example/x", "doi": "https://doi.org/10.1000/abc.1",
        "pubmed": "https://pubmed.ncbi.nlm.nih.gov/111/", "pmc": "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/",
        "arxiv": "https://arxiv.org/abs/2101.00001", "europepmc": "https://europepmc.org/article/MED/111",
        "openalex": "https://openalex.org/W1001", "semanticscholar": f"https://www.semanticscholar.org/paper/{'a' * 40}",
    }
    assert len({link["url"] for link in links}) == len(links)
    only_doi = discovery.build_links({"source": "crossref", "external_id": DOI, "doi": "10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-o"})
    assert only_doi[0]["url"] == "https://doi.org/10.1002/(sici)1097-4571(199806)49:8%3C693::aid-asi4%3E3.0.co;2-o"
    assert discovery.build_links({"source": "pubmed", "external_id": "5"}) == []  # no ids -> no invented links


def test_search_results_and_saved_papers_carry_the_same_ids_and_links(client, upstream):
    register(client)
    body = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,pubmed,crossref"}).json()
    main = next(p for p in body["results"] if p["doi"] == DOI)
    kinds = {link["kind"] for link in main["links"]}
    assert {"doi", "pubmed", "openalex"} <= kinds and main["pmid"] == "111"
    pid = client.post("/api/projects", json=VALID).json()["id"]
    saved = client.post(f"/api/projects/{pid}/papers", json={"source": "pubmed", "external_id": "111"}).json()
    assert saved["pmid"] == "111" and saved["doi"] == DOI
    assert {"doi": "https://doi.org/" + DOI, "pubmed": "https://pubmed.ncbi.nlm.nih.gov/111/"}.items() <= {link["kind"]: link["url"] for link in saved["links"]}.items()


def test_long_doi_external_id_can_be_saved(client, upstream, monkeypatch):
    register(client)
    long_doi = "10.1000/" + "x" * 150
    item = {**CROSSREF["message"]["items"][0], "DOI": long_doi}
    orig = literature.http_get_json
    monkeypatch.setattr(literature, "http_get_json", lambda url, params, headers=None: {"message": item} if "/works/" in url else orig(url, params))
    pid = client.post("/api/projects", json=VALID).json()["id"]
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "crossref", "external_id": long_doi})
    assert r.status_code == 201 and r.json()["external_id"] == long_doi


def test_timeout_and_rate_limit_are_reported_with_a_kind(client, upstream, monkeypatch):
    register(client)
    def boom_timeout(q, p, n):
        raise literature.LiteratureTimeout("The literature source did not answer within 10 s.")
    def boom_rate(q, p, n):
        raise literature.LiteratureRateLimited("rate-limiting")
    monkeypatch.setitem(discovery.BY_ID, "arxiv", discovery.Provider("arxiv", "arXiv", "cs", boom_timeout, discovery.fetch_arxiv, "", ""))
    monkeypatch.setitem(discovery.BY_ID, "crossref", discovery.Provider("crossref", "Crossref", "general", boom_rate, discovery.fetch_crossref, "", ""))
    body = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,arxiv,crossref"}).json()
    kinds = {p["provider"]: p["error_kind"] for p in body["providers"]}
    assert kinds == {"openalex": None, "arxiv": "timeout", "crossref": "rate_limit"}


def test_real_timeout_exception_maps_to_timeout_kind(monkeypatch):
    def slow(url, **kw):
        raise httpx.ReadTimeout("slow")
    monkeypatch.setattr(httpx, "get", slow)
    monkeypatch.setattr("app.services.literature.time.sleep", lambda s: None)
    with pytest.raises(literature.LiteratureTimeout):
        literature.http_get_json("https://example.org/x", {})


def test_html_entities_in_titles_are_decoded_but_tags_are_still_stripped():
    cr = discovery.parse_crossref_item({"DOI": "10.1/x", "title": ["Association of EEG &amp; MRI in <i>prodromal</i> AD &lt;3 years"]})
    assert cr["title"] == "Association of EEG & MRI in prodromal AD <3 years"


def test_doi_org_landing_page_is_not_presented_as_a_publisher_page():
    kinds = {link["kind"] for link in discovery.build_links({"source": "openalex", "external_id": "W1", "doi": DOI, "publisher_url": f"https://doi.org/{DOI}"})}
    assert kinds == {"doi", "openalex"}
    real = discovery.build_links({"source": "openalex", "external_id": "W1", "doi": DOI, "publisher_url": "https://www.nature.com/articles/x"})
    assert [link["kind"] for link in real][:2] == ["publisher", "doi"]


# ------------------------------------------------------------------ Springer Nature
def test_springer_parser_handles_names_urls_abstract_shapes_and_skips_doiless_records():
    recs = [discovery.parse_springer_record(r) for r in SPRINGER_JSON["records"]]
    a, b, none = recs
    assert none is None
    assert a["doi"] == DOI and a["authors"] == ["Ada Lovelace"] and a["year"] == 2023 and a["venue"] == "NeuroImage"
    assert a["publisher_url"] == "https://link.springer.com/article/10.1000/abc.1" and a["abstract"] == "We train a 3D CNN on ADNI."
    assert b["authors"] == ["Hopper"] and b["abstract"] == "Abstract Structured abstract text."
    assert b["publisher_url"] is None and b["url"] == "https://doi.org/10.1007/book"  # doi.org is not a publisher page


def test_springer_without_a_key_is_off_by_default_and_reports_not_configured(client, upstream):
    register(client)
    r = client.get("/api/literature/search", params={"q": "alzheimer mri"})
    assert "springer" not in [p["provider"] for p in r.json()["providers"]]
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,springer"})
    st = {p["provider"]: p for p in r.json()["providers"]}
    assert st["springer"]["ok"] is False and st["springer"]["error_kind"] == "not_configured" and "SPRINGER_API_KEY" in st["springer"]["error"]
    assert st["openalex"]["ok"] and not any(c[0] == "springer" for c in upstream["calls"])


def test_springer_with_key_searches_meta_v2_pages_and_merges_by_doi(client, upstream, settings, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "springer_api_key", "SPR-SECRET")
    assert next(p for p in client.get("/api/literature/providers").json() if p["id"] == "springer")["default_enabled"] is True
    body = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,springer", "page": 2}).json()
    call = next(c for c in upstream["calls"] if c[0] == "springer")
    assert call[1] == {"q": "alzheimer mri", "p": 10, "s": 11, "api_key": "SPR-SECRET"}
    main = next(p for p in body["results"] if p["doi"] == DOI)
    assert {s["provider"] for s in main["sources"]} == {"openalex", "springer"}
    assert "SPR-SECRET" not in client.get("/api/literature/providers").text and "SPR-SECRET" not in str(body)
    assert len(body["results"]) == 2  # OpenAlex paper merged with Springer's; the Springer-only record is kept


def test_springer_oa_key_alone_uses_the_open_access_endpoint(client, upstream, settings, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "springer_oa_api_key", "OA-KEY")
    seen = []
    orig = literature.http_get_json
    monkeypatch.setattr(literature, "http_get_json", lambda url, params, headers=None: (seen.append(url), orig(url, params))[1])
    client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "springer"})
    assert seen == ["https://api.springernature.com/openaccess/json"]


def test_springer_save_fetches_by_doi_and_rejects_injection(client, upstream, settings, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "springer_api_key", "k")
    pid = client.post("/api/projects", json=VALID).json()["id"]
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "springer", "external_id": DOI})
    assert r.status_code == 201 and r.json()["source"] == "springer" and r.json()["publisher_url"].startswith("https://link.springer.com/")
    q = next(c for c in upstream["calls"] if c[0] == "springer")[1]["q"]
    assert q == f'doi:"{DOI}"'
    bad = client.post(f"/api/projects/{pid}/papers", json={"source": "springer", "external_id": '10.1000/x" OR title:"y'})
    assert bad.status_code == 404


def test_api_keys_are_not_logged_by_httpx():
    import logging
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
