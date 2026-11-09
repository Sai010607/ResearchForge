"""Publication-type classification and identifier verification.

Two kinds of checking, both honest about what they can know:

* `cross_check` runs on every search result with NO extra network calls. It compares what the
  providers that returned the same paper said (titles, years, first authors, identifiers) and reports
  agreement or disagreement. "Cross-checked" means "independent sources agree", not "proven correct".
* `check_identifiers` is the on-demand deep check. It asks the authoritative registry for each
  identifier (Crossref for DOIs, PubMed for PMIDs, the NCBI ID converter for PMCID<->PMID<->DOI, arXiv
  for arXiv ids) and compares the title, year and first author it gets back with the record.

Neither check ever changes a record's identifiers: a disagreement is reported, not "fixed".
"""
import re
from typing import Any
from urllib.parse import quote

from app.services import literature
from app.services.literature import LiteratureError, PaperNotFound

# --------------------------------------------------------------------------- publication type
PUBLICATION_TYPES = ("journal_article", "review", "conference_paper", "book_chapter", "book", "preprint", "other", "unknown")

# normalised raw label (lower-case, letters+digits only) -> type. Labels come from each provider's own
# type field; nothing is guessed from the title.
_TYPE_MAP: dict[str, str] = {
    # preprints
    "preprint": "preprint", "postedcontent": "preprint", "sourceppr": "preprint", "ppr": "preprint",
    # chapters
    "bookchapter": "book_chapter", "booksection": "book_chapter", "chapter": "book_chapter", "bookpart": "book_chapter",
    "referenceentry": "book_chapter", "booktrack": "book_chapter", "sourcenbk": "book_chapter",
    # books
    "book": "book", "monograph": "book", "editedbook": "book", "referencebook": "book", "bookset": "book", "bookseries": "book",
    # conference
    "proceedingsarticle": "conference_paper", "conference": "conference_paper", "conferencepaper": "conference_paper",
    "inproceedings": "conference_paper", "proceedings": "conference_paper", "conferenceproceedings": "conference_paper",
    # reviews
    "review": "review", "systematicreview": "review", "reviewarticle": "review", "literaturereview": "review",
    "scopingreview": "review", "reviewpaper": "review", "narrativereview": "review",
    # journal articles
    "journalarticle": "journal_article", "article": "journal_article", "researcharticle": "journal_article",
    "originalpaper": "journal_article", "originalarticle": "journal_article", "casereports": "journal_article",
    "journal": "journal_article", "shortcommunication": "journal_article",
    # recognised but not one of the six requested classes
    "editorial": "other", "letter": "other", "erratum": "other", "correction": "other", "retraction": "other", "dataset": "other",
    "peerreview": "other", "report": "other", "dissertation": "other", "thesis": "other", "standard": "other", "paratext": "other",
    "comment": "other", "news": "other", "patent": "other", "other": "other", "grant": "other", "reference": "other",
}
# When several labels disagree the more specific one wins: a "proceedings-article" that OpenAlex also calls a generic "article" is a
# conference paper; a chapter is never promoted to an article.
_SPECIFICITY = ("preprint", "book_chapter", "book", "conference_paper", "review", "journal_article", "other")


def _norm_label(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", label.lower())


def classify_publication(raw_types: list[str], doi: str | None = None, sources: list[str] | None = None) -> str:
    """Map provider type labels to one of PUBLICATION_TYPES. "unknown" when no provider said anything usable."""
    found: set[str] = set()
    for t in raw_types:
        n = _norm_label(t)
        if n in _TYPE_MAP:
            found.add(_TYPE_MAP[n])
        elif n.startswith("source") and n[6:].upper() == "PPR":
            found.add("preprint")
    if "arxiv" in (sources or []) or (doi or "").startswith(("10.48550/", "10.21203/", "10.1101/", "10.20944/")):
        found.add("preprint")  # arXiv itself; Research Square, bioRxiv/medRxiv and Preprints.org DOI prefixes
    for t in _SPECIFICITY:
        if t in found:
            return t
    return "unknown"


# --------------------------------------------------------------------------- text helpers
_WORD = re.compile(r"[a-z0-9]+")


def _words(t: str | None) -> set[str]:
    return set(_WORD.findall((t or "").lower()))


def title_overlap(a: str | None, b: str | None) -> float:
    """Share of the shorter title's words that also occur in the other (1.0 = same words). Robust to subtitles and punctuation."""
    x, y = _words(a), _words(b)
    if not x or not y:
        return 0.0
    return len(x & y) / min(len(x), len(y))


def _surname_tokens(author: str | None) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", (author or "").lower()) if len(t) > 1}


def first_author_agrees(a: list[str], b: list[str]) -> bool | None:
    """None when either side has no authors. Tolerates 'Ada Lovelace' vs 'Lovelace A' vs 'Lovelace, Ada'."""
    if not a or not b:
        return None
    return bool(_surname_tokens(a[0]) & _surname_tokens(b[0]))


def _check(cid: str, status: str, detail: str) -> dict[str, str]:
    return {"id": cid, "status": status, "detail": detail}  # status: pass | warn | fail | info


def _overall(checks: list[dict[str, str]], n_sources: int) -> str:
    if any(c["status"] == "fail" for c in checks):
        return "conflict"
    if any(c["status"] == "warn" for c in checks):
        return "warning"
    return "cross_checked" if n_sources > 1 else "single_source"


# --------------------------------------------------------------------------- search-time cross-check
def cross_check(members: list[dict[str, Any]], merged: dict[str, Any], conflicts: list[str] | None = None) -> dict[str, Any]:
    """Compare the provider records that were merged into one result. No network."""
    checks: list[dict[str, str]] = []
    n = len({m["source"] for m in members})
    for msg in conflicts or []:
        checks.append(_check("identifier_conflict", "fail", msg))

    doi = merged.get("doi")
    if doi and not re.fullmatch(r"10\.\d{4,9}/\S+", doi):
        checks.append(_check("doi_format", "fail", f"“{doi}” is not a valid DOI."))
    aid = merged.get("arxiv_id")
    m = re.fullmatch(r"10\.48550/arxiv\.(.+)", doi or "")
    if m and aid and re.sub(r"v\d+$", "", m.group(1)).lower() != aid.lower():
        checks.append(_check("arxiv_doi", "fail", f"The arXiv DOI names {m.group(1)} but the arXiv id is {aid}."))
    if merged.get("pmcid") and not re.fullmatch(r"PMC\d{1,10}", merged["pmcid"]):
        checks.append(_check("pmcid_format", "fail", "The PMCID is not in PMC<digits> form."))
    if merged.get("pmid") and not re.fullmatch(r"\d{1,9}", str(merged["pmid"])):
        checks.append(_check("pmid_format", "fail", "The PMID is not numeric."))

    if len(members) > 1:
        worst = min(title_overlap(a["title"], b["title"]) for i, a in enumerate(members) for b in members[i + 1:])
        checks.append(_check("title", "pass" if worst >= 0.9 else "warn" if worst >= 0.6 else "fail",
                             "Titles agree across sources." if worst >= 0.9 else "Titles differ in wording between sources."))
        years = [m["year"] for m in members if m.get("year")]
        if len(set(years)) > 1:
            spread = max(years) - min(years)
            checks.append(_check("year", "info" if spread <= 1 else "warn",
                                 f"Sources give {', '.join(str(y) for y in sorted(set(years)))}" + (" (online-first vs issue year is common)." if spread <= 1 else ".")))
        elif years:
            checks.append(_check("year", "pass", "Publication year agrees."))
        firsts = [m["authors"] for m in members if m.get("authors")]
        if len(firsts) > 1:
            ok = all(first_author_agrees(firsts[0], other) for other in firsts[1:])
            checks.append(_check("first_author", "pass" if ok else "warn", "First author agrees." if ok else "First author differs between sources."))
        ids = [("doi", "DOI"), ("pmid", "PMID")]
        for key, label in ids:
            vals = {str(m[key]) for m in members if m.get(key)}
            if len(vals) == 1 and sum(1 for m in members if m.get(key)) > 1:
                checks.append(_check(f"{key}_agree", "pass", f"{label} matches in {sum(1 for m in members if m.get(key))} sources."))
    return {"status": _overall(checks, n), "sources_agreeing": n, "checks": checks}


# --------------------------------------------------------------------------- on-demand identifier verification
IDCONV = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/"


def _compare(cid: str, label: str, paper: dict[str, Any], ref: dict[str, Any]) -> list[dict[str, str]]:
    """Compare the record with what the authoritative registry returned for one of its identifiers."""
    out = []
    ov = title_overlap(paper["title"], ref.get("title"))
    out.append(_check(f"{cid}_title", "pass" if ov >= 0.85 else "warn" if ov >= 0.6 else "fail",
                      f"{label} title matches." if ov >= 0.85 else f"{label} title differs: “{(ref.get('title') or '')[:80]}”."))
    if paper.get("year") and ref.get("year"):
        d = abs(paper["year"] - ref["year"])
        out.append(_check(f"{cid}_year", "pass" if d == 0 else "info" if d == 1 else "warn", f"{label} year {ref['year']} (record: {paper['year']})."))
    fa = first_author_agrees(paper.get("authors") or [], ref.get("authors") or [])
    if fa is not None:
        out.append(_check(f"{cid}_author", "pass" if fa else "warn", f"{label} first author {'matches' if fa else 'differs'}."))
    return out


def check_identifiers(paper: dict[str, Any]) -> dict[str, Any]:
    """Ask each identifier's authoritative registry and compare. Unreachable registries give "info", never a false pass."""
    from app.services import discovery  # local: discovery imports this module

    checks: list[dict[str, str]] = []

    def guarded(cid: str, label: str, fn) -> None:
        try:
            fn()
        except PaperNotFound:
            checks.append(_check(f"{cid}_exists", "fail", f"{label} does not exist at its registry."))
        except LiteratureError as exc:
            checks.append(_check(f"{cid}_exists", "info", f"{label} could not be checked: {exc}"))

    doi, pmid, pmcid, aid = paper.get("doi"), paper.get("pmid"), paper.get("pmcid"), paper.get("arxiv_id")
    if doi:
        def _doi() -> None:
            try:
                ref = discovery.fetch_crossref(doi)
            except PaperNotFound:
                h = literature.http_get_json(f"https://doi.org/api/handles/{quote(doi, safe='/')}", {})
                if (h or {}).get("responseCode") == 1:
                    checks.append(_check("doi_exists", "pass", "DOI is registered (not a Crossref DOI, so the title was not compared)."))
                else:
                    checks.append(_check("doi_exists", "fail", "DOI is not registered at doi.org."))
                return
            checks.append(_check("doi_exists", "pass", "DOI is registered with Crossref."))
            checks.extend(_compare("doi", "Crossref", paper, ref))
        guarded("doi", "DOI", _doi)
    if pmid:
        def _pmid() -> None:
            ref = discovery.fetch_pubmed(str(pmid))
            checks.append(_check("pmid_exists", "pass", "PMID exists in PubMed."))
            checks.extend(_compare("pmid", "PubMed", paper, ref))
            if doi and ref.get("doi") and ref["doi"] != doi:
                checks.append(_check("pmid_doi", "fail", f"PubMed lists DOI {ref['doi']} for this PMID, not {doi}."))
        guarded("pmid", "PMID", _pmid)
    if pmcid:
        def _pmc() -> None:
            d = literature.http_get_json(IDCONV, {"ids": pmcid, "format": "json", "tool": "researchforge"})
            rec = ((d or {}).get("records") or [{}])[0]
            if rec.get("status") == "error" or not rec:
                checks.append(_check("pmcid_exists", "fail", f"{pmcid} is unknown to PMC."))
                return
            checks.append(_check("pmcid_exists", "pass", f"{pmcid} exists in PMC."))
            if pmid and rec.get("pmid"):
                same = str(rec["pmid"]) == str(pmid)
                checks.append(_check("pmcid_pmid", "pass" if same else "fail", "PMCID maps to the same PMID." if same else f"PMC maps {pmcid} to PMID {rec['pmid']}, not {pmid}."))
            if doi and rec.get("doi"):
                same = str(rec["doi"]).lower() == doi
                checks.append(_check("pmcid_doi", "pass" if same else "fail", "PMCID maps to the same DOI." if same else f"PMC maps {pmcid} to DOI {rec['doi']}, not {doi}."))
        guarded("pmcid", "PMCID", _pmc)
    if aid:
        def _arxiv() -> None:
            ref = discovery.fetch_arxiv(aid)
            checks.append(_check("arxiv_exists", "pass", "arXiv id exists."))
            checks.extend(_compare("arxiv", "arXiv", paper, ref))
        guarded("arxiv", "arXiv id", _arxiv)
    if not checks:
        checks.append(_check("none", "info", "This record has no DOI, PMID, PMCID or arXiv id to verify."))
    status = ("conflict" if any(c["status"] == "fail" for c in checks) else "warning" if any(c["status"] == "warn" for c in checks)
              else "verified" if any(c["status"] == "pass" for c in checks) else "unchecked")
    return {"status": status, "checks": checks}
