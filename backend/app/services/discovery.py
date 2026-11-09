"""Multi-source literature discovery: provider registry, concurrent search, normalisation, dedupe.

Every provider is an independent adapter (search + fetch-by-id) that returns the SAME dict shape as
`literature.parse_openalex_work`. A failing provider only produces a status entry, never an error
for the others. Network access goes through `literature.http_get_json` / `http_get_text` (the test
seams). Nothing is invented: fields a source does not supply stay None/empty.
"""
import logging
import re
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit

from app.core.config import get_settings
from app.services import literature, ranking, verify
from app.services.literature import LiteratureError, LiteratureNotConfigured, PaperNotFound, _clean, normalize_doi, normalize_pmcid, safe_url

log = logging.getLogger("researchforge.discovery")

CROSSREF = "https://api.crossref.org"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ARXIV = "https://export.arxiv.org/api/query"
S2 = "https://api.semanticscholar.org/graph/v1"
SPRINGER = "https://api.springernature.com"
S2_FIELDS = "title,abstract,year,venue,authors,externalIds,citationCount,url,referenceCount,publicationTypes,openAccessPdf"
DOI_RE = re.compile(r"10\.\d{4,9}/\S{1,150}")
ARXIV_RE = re.compile(r"\d{4}\.\d{4,5}(v\d+)?|[a-z\-]+(\.[A-Za-z]{2})?/\d{7}(v\d+)?")


def _get_json(url: str, params: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    # call through the module so tests can replace literature.http_get_json
    return literature.http_get_json(url, params, headers=headers) if headers else literature.http_get_json(url, params)


def _get_text(url: str, params: dict[str, Any]) -> str:
    return literature.http_get_text(url, params)


def _safe_xml(text: str) -> ET.Element:
    if "<!ENTITY" in text:  # entity-expansion attacks need entity declarations; real feeds have none
        raise LiteratureError("The literature source returned an unsafe XML document.")
    try:
        return ET.fromstring(text)
    except ET.ParseError as exc:
        raise LiteratureError("The literature source returned an unreadable response.") from exc


def _year(value: Any) -> int | None:
    m = re.search(r"(19|20)\d{2}", str(value or ""))
    return int(m.group(0)) if m else None


# ----------------------------------------------------------------------------- Crossref
CR_SELECT = "DOI,title,abstract,author,issued,container-title,is-referenced-by-count,URL,type,subtype,subject,resource"


def parse_crossref_item(it: dict[str, Any]) -> dict[str, Any] | None:
    title = _clean((it.get("title") or [None])[0])
    doi = normalize_doi(it.get("DOI"))
    if not title or not doi:
        return None
    parts = ((it.get("issued") or {}).get("date-parts") or [[None]])[0]
    authors = []
    for a in it.get("author") or []:
        name = " ".join(x for x in (a.get("given"), a.get("family")) if x) or a.get("name")
        if name:
            authors.append(name)
    return {
        "source": "crossref", "external_id": doi, "doi": doi, "pmid": None, "pmcid": None,
        "publisher_url": safe_url(((it.get("resource") or {}).get("primary") or {}).get("URL")), "oa_url": None,
        "pub_types": [t for t in (it.get("type"), it.get("subtype")) if isinstance(t, str)],
        "title": title, "abstract": _clean(it.get("abstract")),
        "year": parts[0] if parts and isinstance(parts[0], int) else None,
        "venue": (it.get("container-title") or [None])[0],
        "authors": authors[:30], "url": it.get("URL") or f"https://doi.org/{doi}",
        "cited_by_count": it.get("is-referenced-by-count"),
        "keywords": [k for k in (it.get("subject") or []) if isinstance(k, str)][:15],
        "reference_ids": [],
    }


def search_crossref(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"query": query, "rows": per_page, "offset": (page - 1) * per_page, "select": CR_SELECT}
    if get_settings().contact_email:
        params["mailto"] = get_settings().contact_email
    items = ((_get_json(f"{CROSSREF}/works", params) or {}).get("message") or {}).get("items") or []
    return [p for p in (parse_crossref_item(i) for i in items) if p]


def fetch_crossref(external_id: str) -> dict[str, Any]:
    if not DOI_RE.fullmatch(external_id):
        raise PaperNotFound("Unrecognised DOI.")
    data = _get_json(f"{CROSSREF}/works/{quote(external_id, safe='/')}", {})
    paper = parse_crossref_item((data or {}).get("message") or {})
    if paper is None:
        raise PaperNotFound("Paper not found at the source.")
    return paper


# ----------------------------------------------------------------------------- PubMed
def _text(el: ET.Element | None) -> str | None:
    return _clean("".join(el.itertext())) if el is not None else None


def parse_pubmed_xml(xml: str) -> list[dict[str, Any]]:
    root = _safe_xml(xml)
    out = []
    for art in root.iter("PubmedArticle"):
        pmid = _text(art.find("MedlineCitation/PMID"))
        title = _text(art.find("MedlineCitation/Article/ArticleTitle"))
        if not pmid or not title:
            continue
        parts = []
        for ab in art.findall("MedlineCitation/Article/Abstract/AbstractText"):
            t = _text(ab)
            if t:
                label = ab.get("Label")
                parts.append(f"{label.title()}: {t}" if label else t)
        authors = []
        for a in art.findall("MedlineCitation/Article/AuthorList/Author"):
            last, fore = _text(a.find("LastName")), _text(a.find("ForeName"))
            name = " ".join(x for x in (fore, last) if x) or _text(a.find("CollectiveName"))
            if name:
                authors.append(name)
        doi = pmcid = None
        for aid in art.findall("PubmedData/ArticleIdList/ArticleId"):
            if aid.get("IdType") == "doi":
                doi = normalize_doi(_text(aid))
            elif aid.get("IdType") == "pmc":
                pmcid = normalize_pmcid(_text(aid))
        pd = art.find("MedlineCitation/Article/Journal/JournalIssue/PubDate")
        year = _year(_text(pd.find("Year")) or _text(pd.find("MedlineDate"))) if pd is not None else None
        mesh = [_text(m) for m in art.findall("MedlineCitation/MeshHeadingList/MeshHeading/DescriptorName")]
        kws = [_text(k) for k in art.findall("MedlineCitation/KeywordList/Keyword")]
        ptypes = [t for t in (_text(x) for x in art.findall("MedlineCitation/Article/PublicationTypeList/PublicationType")) if t]
        out.append({
            "source": "pubmed", "external_id": pmid, "doi": doi, "pmid": pmid, "pmcid": pmcid, "publisher_url": None, "oa_url": None,
            "pub_types": ptypes, "title": title,
            "abstract": " ".join(parts) or None, "year": year,
            "venue": _text(art.find("MedlineCitation/Article/Journal/Title")),
            "authors": authors[:30], "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            "cited_by_count": None,  # PubMed does not supply citation counts
            "keywords": [k for k in kws + mesh if k][:15], "reference_ids": [],
        })
    return out


def _eutils_params(extra: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    p: dict[str, Any] = {"tool": "researchforge", **extra}
    if s.contact_email:
        p["email"] = s.contact_email
    if s.ncbi_api_key:
        p["api_key"] = s.ncbi_api_key
    return p


def _efetch_pubmed(ids: list[str]) -> list[dict[str, Any]]:
    xml = _get_text(f"{EUTILS}/efetch.fcgi", _eutils_params({"db": "pubmed", "id": ",".join(ids), "retmode": "xml"}))
    by_id = {p["external_id"]: p for p in parse_pubmed_xml(xml)}
    return [by_id[i] for i in ids if i in by_id]  # keep the relevance order esearch gave


def search_pubmed(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    data = _get_json(f"{EUTILS}/esearch.fcgi", _eutils_params(
        {"db": "pubmed", "term": query, "retmode": "json", "retmax": per_page, "retstart": (page - 1) * per_page}))
    ids = [i for i in ((data or {}).get("esearchresult") or {}).get("idlist") or [] if str(i).isdigit()]
    return _efetch_pubmed(ids) if ids else []


def fetch_pubmed(external_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"\d{1,9}", external_id):
        raise PaperNotFound("Unrecognised PubMed id.")
    found = _efetch_pubmed([external_id])
    if not found:
        raise PaperNotFound("Paper not found at the source.")
    return found[0]


# ----------------------------------------------------------------------------- arXiv
_A = "{http://www.w3.org/2005/Atom}"
_X = "{http://arxiv.org/schemas/atom}"


def parse_arxiv_atom(xml: str) -> list[dict[str, Any]]:
    root = _safe_xml(xml)
    out = []
    for e in root.iter(f"{_A}entry"):
        raw_id = _text(e.find(f"{_A}id")) or ""
        m = re.search(r"arxiv\.org/abs/(.+)$", raw_id)
        title = _text(e.find(f"{_A}title"))
        if not m or not title:
            continue
        aid = re.sub(r"v\d+$", "", m.group(1))
        doi = normalize_doi(_text(e.find(f"{_X}doi")))
        out.append({
            "source": "arxiv", "external_id": aid, "doi": doi, "pmid": None, "pmcid": None, "publisher_url": None, "oa_url": None, "pub_types": ["preprint"], "arxiv_id": aid.lower(),
            "title": title, "abstract": _text(e.find(f"{_A}summary")), "year": _year(_text(e.find(f"{_A}published"))),
            "venue": _text(e.find(f"{_X}journal_ref")) or "arXiv preprint",
            "authors": [n for n in (_text(a.find(f"{_A}name")) for a in e.findall(f"{_A}author")) if n][:30],
            "url": f"https://arxiv.org/abs/{aid}", "cited_by_count": None,
            "keywords": [c.get("term") for c in e.findall(f"{_A}category") if c.get("term")][:15], "reference_ids": [],
        })
    return out


def search_arxiv(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    terms = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-']*", query)[:12]
    if not terms:
        return []
    q = " AND ".join(f"all:{t}" for t in terms)
    return parse_arxiv_atom(_get_text(ARXIV, {"search_query": q, "start": (page - 1) * per_page, "max_results": per_page}))


def fetch_arxiv(external_id: str) -> dict[str, Any]:
    if not ARXIV_RE.fullmatch(external_id):
        raise PaperNotFound("Unrecognised arXiv id.")
    found = parse_arxiv_atom(_get_text(ARXIV, {"id_list": external_id, "max_results": 1}))
    if not found:
        raise PaperNotFound("Paper not found at the source.")
    return found[0]


# ----------------------------------------------------------------------------- Semantic Scholar
def parse_s2_paper(w: dict[str, Any]) -> dict[str, Any] | None:
    title, pid = _clean(w.get("title")), w.get("paperId")
    if not title or not pid:
        return None
    ids = w.get("externalIds") or {}
    arxiv = ids.get("ArXiv")
    return {
        "source": "semanticscholar", "external_id": pid, "doi": normalize_doi(ids.get("DOI")),
        "pmid": str(ids["PubMed"]) if ids.get("PubMed") else None, "pmcid": normalize_pmcid(ids.get("PubMedCentral")),
        "publisher_url": None, "oa_url": safe_url((w.get("openAccessPdf") or {}).get("url")),
        "pub_types": [t for t in (w.get("publicationTypes") or []) if isinstance(t, str)], "arxiv_id": arxiv.lower() if arxiv else None,
        "title": title, "abstract": _clean(w.get("abstract")), "year": w.get("year"), "venue": w.get("venue") or None,
        "authors": [a["name"] for a in (w.get("authors") or []) if a.get("name")][:30],
        "url": w.get("url") or f"https://www.semanticscholar.org/paper/{pid}",
        "cited_by_count": w.get("citationCount"), "keywords": [], "reference_ids": [],
    }


def _s2_headers() -> dict[str, str] | None:
    key = get_settings().semantic_scholar_api_key
    return {"x-api-key": key} if key else None


def search_semanticscholar(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    data = _get_json(f"{S2}/paper/search", {"query": query, "offset": (page - 1) * per_page, "limit": per_page, "fields": S2_FIELDS}, _s2_headers())
    return [p for p in (parse_s2_paper(w) for w in (data or {}).get("data") or []) if p]


def fetch_semanticscholar(external_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{40}", external_id):
        raise PaperNotFound("Unrecognised Semantic Scholar id.")
    paper = parse_s2_paper(_get_json(f"{S2}/paper/{external_id}", {"fields": S2_FIELDS}, _s2_headers()) or {})
    if paper is None:
        raise PaperNotFound("Paper not found at the source.")
    return paper


# ----------------------------------------------------------------------------- Springer Nature
_SPRINGER_HTTPS_HOSTS = ("link.springer.com", "springeropen.com", "biomedcentral.com", "nature.com")


def _springer_text(v: Any) -> str | None:
    """Abstract may be a string or a small structure of strings; only text the source gave is used."""
    if isinstance(v, str):
        return _clean(v)
    if isinstance(v, dict):
        return _clean(" ".join(t for t in (_springer_text(x) for x in v.values()) if t))
    if isinstance(v, list):
        return _clean(" ".join(t for t in (_springer_text(x) for x in v) if t))
    return None


def parse_springer_record(r: dict[str, Any]) -> dict[str, Any] | None:
    title, doi = _clean(r.get("title")), normalize_doi(r.get("doi"))
    if not title or not doi:  # books without a DOI cannot be fetched again by id, so they are skipped
        return None
    authors = []
    for c in r.get("creators") or []:
        name = (c.get("creator") if isinstance(c, dict) else c) or ""
        last, _, first = name.partition(",")
        name = f"{first.strip()} {last.strip()}".strip() if first.strip() else name.strip()
        if name:
            authors.append(name)
    page = None
    for u in r.get("url") or []:
        v = u.get("value") if isinstance(u, dict) else None
        if v and (u.get("format") or "html") in ("html", "") and not re.match(r"https?://(dx\.)?doi\.org/", v):
            page = v
            break
    if page and page.startswith("http://") and any(h in page.split("/")[2] for h in _SPRINGER_HTTPS_HOSTS):
        page = "https://" + page[len("http://"):]
    page = safe_url(page)
    kws = r.get("keyword") or r.get("subjects") or []
    # Real Meta v2 records carry space-separated strings, e.g. contentType "Chapter ConferencePaper", genre "OriginalPaper Proceedings".
    # `publicationType` describes the HOST publication (a chapter's is "Book"), so it is not used.
    ptypes = [t for field in (r.get("contentType"), r.get("genre")) for t in (field if isinstance(field, list) else str(field or "").split()) if isinstance(t, str)]
    if "ConferencePaper" in ptypes:  # a conference paper published as a book chapter is reported as the conference paper
        ptypes = [t for t in ptypes if t not in ("Chapter", "OriginalPaper")]
    return {
        "source": "springer", "external_id": doi, "doi": doi, "pmid": None, "pmcid": None, "publisher_url": page,
        "oa_url": page if str(r.get("openaccess")).lower() == "true" else None,  # Springer says this record is open access: its own page is the full text
        "pub_types": ptypes,
        "title": title, "abstract": _springer_text(r.get("abstract")), "year": _year(r.get("publicationDate")),
        "venue": r.get("publicationName") or None, "authors": authors[:30], "url": page or f"https://doi.org/{doi}",
        "cited_by_count": None, "keywords": [k for k in kws if isinstance(k, str)][:15], "reference_ids": [],
    }


def _springer_endpoint() -> tuple[str, str]:
    s = get_settings()
    if s.springer_api_key:
        return f"{SPRINGER}/meta/v2/json", s.springer_api_key
    if s.springer_oa_api_key:
        return f"{SPRINGER}/openaccess/json", s.springer_oa_api_key
    raise LiteratureNotConfigured("Springer Nature needs an API key. Set SPRINGER_API_KEY on the server (free key from dev.springernature.com).")


def search_springer(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    url, key = _springer_endpoint()
    data = _get_json(url, {"q": query, "p": per_page, "s": (page - 1) * per_page + 1, "api_key": key})
    return [p for p in (parse_springer_record(r) for r in (data or {}).get("records") or []) if p]


def fetch_springer(external_id: str) -> dict[str, Any]:
    if not DOI_RE.fullmatch(external_id) or '"' in external_id:
        raise PaperNotFound("Unrecognised DOI.")
    url, key = _springer_endpoint()
    data = _get_json(url, {"q": f'doi:"{external_id}"', "p": 1, "s": 1, "api_key": key})
    for r in (data or {}).get("records") or []:
        paper = parse_springer_record(r)
        if paper and paper["doi"] == external_id.lower():
            return paper
    raise PaperNotFound("Paper not found at the source.")


# ----------------------------------------------------------------------------- registry
@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    group: str  # "general" | "biomedical" | "cs"
    search: Callable[[str, int, int], list[dict[str, Any]]]
    fetch: Callable[[str], dict[str, Any]]
    docs: str
    rate_limit: str
    key_setting: str | None = None  # name of the optional backend setting / env var
    key_required: bool = False
    default_on: bool = True
    alt_key_setting: str | None = None

    def has_key(self) -> bool:
        s = get_settings()
        return any(getattr(s, k.lower(), "") for k in (self.key_setting, self.alt_key_setting) if k)


# Order = merge priority: the first provider's record becomes the canonical one (OpenAlex also
# supplies reference lists used for citation links).
PROVIDERS: tuple[Provider, ...] = (
    Provider("openalex", "OpenAlex", "general", literature.search_openalex, literature.fetch_openalex,
             "https://docs.openalex.org/", "Polite pool when CONTACT_EMAIL is set"),
    Provider("pubmed", "PubMed", "biomedical", search_pubmed, fetch_pubmed,
             "https://www.ncbi.nlm.nih.gov/books/NBK25497/", "3 req/s; 10 req/s with NCBI_API_KEY", "NCBI_API_KEY"),
    Provider("europepmc", "Europe PMC", "biomedical", literature.search_europepmc, literature.fetch_europepmc,
             "https://europepmc.org/RestfulWebService", "No published hard limit"),
    Provider("crossref", "Crossref", "general", search_crossref, fetch_crossref,
             "https://api.crossref.org/swagger-ui/index.html", "Polite pool when CONTACT_EMAIL is set"),
    Provider("springer", "Springer Nature", "general", search_springer, fetch_springer,
             "https://dev.springernature.com/", "Free key; fair-use limits and a result window of about 200 per query",
             "SPRINGER_API_KEY", key_required=True, default_on=False, alt_key_setting="SPRINGER_OA_API_KEY"),
    Provider("semanticscholar", "Semantic Scholar", "cs", search_semanticscholar, fetch_semanticscholar,
             "https://api.semanticscholar.org/api-docs/", "Shared pool without a key (often rate-limited); 1 req/s with key",
             "SEMANTIC_SCHOLAR_API_KEY", default_on=False),
    Provider("arxiv", "arXiv", "cs", search_arxiv, fetch_arxiv,
             "https://info.arxiv.org/help/api/", "About 1 request per 3 s; preprints only"),
)
BY_ID = {p.id: p for p in PROVIDERS}
PRIORITY = {p.id: i for i, p in enumerate(PROVIDERS)}
SOURCE_IDS = tuple(BY_ID)


def registry() -> list[dict[str, Any]]:
    return [
        {
            "id": p.id, "name": p.name, "group": p.group, "requires_key": p.key_required,
            "supports_key": p.key_setting is not None, "key_configured": p.has_key(),
            "default_enabled": p.default_on or p.has_key(), "supports_search": True,
            "supports_full_text": False,  # metadata + abstracts only; no full-text retrieval yet
            "rate_limit": p.rate_limit, "docs": p.docs, "env_var": p.key_setting,
        }
        for p in PROVIDERS
    ]


def default_provider_ids() -> list[str]:
    return [p.id for p in PROVIDERS if p.default_on or p.has_key()]


def fetch_paper(source: str, external_id: str) -> dict[str, Any]:
    p = BY_ID.get(source)
    if p is None:
        raise PaperNotFound("Unknown source.")
    rec = p.fetch(external_id)
    rec["publication_type"] = verify.classify_publication(rec.get("pub_types") or [], rec.get("doi"), [rec["source"]])
    return rec


# ----------------------------------------------------------------------------- links
# Hosts that are indexes, aggregators or repositories. A URL there is never labelled "Publisher page": the record has its own
# DOI / PubMed / PMC / arXiv / source link built from identifiers.
_NOT_PUBLISHER = ("doi.org", "ncbi.nlm.nih.gov", "europepmc.org", "arxiv.org", "semanticscholar.org", "openalex.org", "researchgate.net",
                  "academia.edu", "scholar.archive.org", "core.ac.uk", "base-search.net", "worldcat.org")


def _host(url: str) -> str:
    return urlsplit(url).netloc.lower().split(":")[0]


def _is_publisher_url(url: str) -> bool:
    h = _host(url)
    if not h or h.startswith("scholar.google."):
        return False
    return not any(h == d or h.endswith("." + d) for d in _NOT_PUBLISHER if not d.endswith("."))


def build_links(p: dict[str, Any]) -> list[dict[str, Any]]:
    """Every link is built from an identifier a source supplied, so it points at that exact record.

    Kinds: fulltext (open-access copy), pmc, publisher (page given by the source), doi, pubmed, arxiv, europepmc, openalex,
    semanticscholar. Duplicated URLs are dropped. Only http(s) URLs are ever emitted.
    """
    refs = {(r["provider"], r["external_id"]) for r in p.get("sources") or []} | {(p["source"], p["external_id"])}
    out: list[tuple[str, str, str]] = []
    pmcid = p.get("pmcid")
    if pmcid and re.fullmatch(r"PMC\d{1,10}", pmcid):
        out.append(("pmc", "PMC full text", f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/"))
    oa = safe_url(p.get("oa_url"))
    if oa:
        out.append(("fulltext", "Open-access full text", oa))
    pub = safe_url(p.get("publisher_url"))
    if pub and _is_publisher_url(pub):
        out.append(("publisher", "Publisher page", pub))
    if p.get("doi"):
        out.append(("doi", "DOI", f"https://doi.org/{quote(p['doi'], safe='/()-._~:;@')}"))
    if p.get("pmid") and re.fullmatch(r"\d{1,9}", str(p["pmid"])):
        out.append(("pubmed", "PubMed", f"https://pubmed.ncbi.nlm.nih.gov/{p['pmid']}/"))
    aid = _arxiv_id(p)
    if aid:
        out.append(("arxiv", "arXiv", f"https://arxiv.org/abs/{aid}"))
    for prov, eid in sorted(refs):
        if prov == "europepmc" and re.fullmatch(r"[A-Z]{2,4}:[A-Za-z0-9]{1,20}", eid):
            src, rid = eid.split(":")
            out.append(("europepmc", "Europe PMC", f"https://europepmc.org/article/{src}/{rid}"))
        elif prov == "openalex" and re.fullmatch(r"W\d+", eid):
            out.append(("openalex", "OpenAlex", f"https://openalex.org/{eid}"))
        elif prov == "semanticscholar" and re.fullmatch(r"[0-9a-f]{40}", eid):
            out.append(("semanticscholar", "Semantic Scholar", f"https://www.semanticscholar.org/paper/{eid}"))
    seen: set[str] = set()
    return [{"kind": k, "label": lab, "url": u} for k, lab, u in out if not (u in seen or seen.add(u))]


# What each link kind gives the reader, best access first. Used to pick the one primary action.
_ACCESS = {"pmc": "full_text", "fulltext": "full_text", "arxiv": "full_text", "publisher": "publisher", "doi": "publisher",
           "pubmed": "abstract", "openalex": "record", "semanticscholar": "record", "europepmc": "record"}
_LABEL = {"pmc": "Read full text (PMC)", "fulltext": "Read open-access full text", "arxiv": "Read preprint copy (arXiv)", "publisher": "Open at publisher",
          "doi": "Open at publisher (DOI)", "pubmed": "View abstract on PubMed", "openalex": "View record (OpenAlex)",
          "semanticscholar": "View record (Semantic Scholar)", "europepmc": "View record (Europe PMC)"}
# DOI before the source-supplied publisher page: the DOI is the registrant's own pointer; a landing URL copied by an aggregator can go stale.
_PRIMARY_ORDER = ("pmc", "fulltext", "arxiv", "doi", "publisher", "pubmed", "openalex", "semanticscholar", "europepmc")


def primary_link(links: list[dict[str, Any]], publication_type: str | None = None) -> dict[str, str] | None:
    """The single "open" action: free full text when a source supplies it, then the publisher (via the publisher page or DOI), then
    abstract pages. Europe PMC pages come last because they can fail for very new records. A preprint's arXiv page IS its full text."""
    by = {l["kind"]: l for l in links}
    for kind in _PRIMARY_ORDER:
        if kind in by:
            label = "Read on arXiv" if kind == "arxiv" and publication_type == "preprint" else _LABEL[kind]
            return {"kind": kind, "url": by[kind]["url"], "access": _ACCESS[kind], "label": label}
    return None


# ----------------------------------------------------------------------------- merge / dedupe
def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def _author_tokens(authors: list[str]) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", (authors[0] if authors else "").lower()) if len(t) > 1}


def _arxiv_id(p: dict[str, Any]) -> str | None:
    if p.get("arxiv_id"):
        return p["arxiv_id"]
    m = re.fullmatch(r"10\.48550/arxiv\.(.+)", p.get("doi") or "")
    return re.sub(r"v\d+$", "", m.group(1)) if m else None


_ID_LABELS = {"doi": "DOI", "pmid": "PMID", "pmcid": "PMCID", "arxiv": "arXiv id"}
_MIN_TITLE_OVERLAP = 0.34  # records sharing an identifier whose titles share fewer words than this are different publications


def _identity(p: dict[str, Any]) -> dict[str, str]:
    ids = {"doi": p.get("doi"), "pmid": str(p["pmid"]) if p.get("pmid") else None, "pmcid": p.get("pmcid"), "arxiv": (_arxiv_id(p) or "").lower() or None}
    return {k: v for k, v in ids.items() if v}


def merge_results(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group records that describe the same paper and merge them, preserving provenance.

    Identity, strongest first: DOI, PMID, PMCID, arXiv id. Weakest (lower confidence): identical normalised title (>= 25 chars)
    AND same year AND overlapping first-author name. Title alone never merges.

    Records are NEVER merged when they carry conflicting identifiers (e.g. same DOI but different PMIDs; a preprint DOI versus the
    journal DOI), or when a shared identifier sits on clearly different titles/years. The conflict is reported on the result's
    `verification` instead of being resolved silently.
    """
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    gids = [_identity(p) for p in items]  # identifiers of each group, by root
    conflicts: dict[int, list[str]] = {}

    def flag(i: int, j: int, msg: str) -> None:
        for k in (i, j):
            conflicts.setdefault(k, [])
            if msg not in conflicts[k]:
                conflicts[k].append(msg)

    def union(i: int, j: int, strong: bool) -> None:
        ri, rj = find(i), find(j)
        if ri == rj:
            return
        for t in _ID_LABELS:
            a, b = gids[ri].get(t), gids[rj].get(t)
            if a and b and a != b:
                preprint_vs_published = t == "doi" and any(x.startswith("10.48550/arxiv.") for x in (a, b))
                if strong and not preprint_vs_published:  # a preprint and its journal version legitimately have two DOIs: kept apart, not an error
                    flag(i, j, f"Another record shares an identifier with this one but has a different {_ID_LABELS[t]} ({a} vs {b}), so they were not merged.")
                return
        if strong:
            yi, yj = items[i].get("year"), items[j].get("year")
            if verify.title_overlap(items[i]["title"], items[j]["title"]) < _MIN_TITLE_OVERLAP:
                flag(i, j, "Another record shares an identifier with this one but has a clearly different title, so they were not merged.")
                return
            if yi and yj and abs(yi - yj) > 2:
                flag(i, j, f"Another record shares an identifier with this one but is from a different year ({yj} vs {yi}), so they were not merged.")
                return
        parent[rj] = ri
        for t, v in gids[rj].items():
            gids[ri].setdefault(t, v)

    owner: dict[tuple[str, str], int] = {}
    for i, p in enumerate(items):
        keys: list[tuple[str, str]] = [(t, v) for t, v in _identity(p).items()]
        nt = _norm_title(p["title"])
        if len(nt) >= 25 and p.get("year") and p.get("authors"):
            keys.append(("weak", f"{nt}|{p['year']}"))
        for k in keys:
            if k in owner:
                j = owner[k]
                if k[0] == "weak" and not (_author_tokens(items[j]["authors"]) & _author_tokens(p["authors"])):
                    continue
                union(i, j, strong=k[0] != "weak")
            else:
                owner[k] = i
    groups: dict[int, list[int]] = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(i)

    merged: list[tuple[int, dict[str, Any]]] = []
    for idxs in groups.values():
        members = sorted((items[i] for i in idxs), key=lambda p: PRIORITY.get(p["source"], 99))
        out = {k: v for k, v in members[0].items() if k not in ("arxiv_id", "_ranks")}
        for m in members[1:]:
            for f in ("abstract", "doi", "pmid", "pmcid", "publisher_url", "oa_url", "year", "venue", "url", "cited_by_count"):
                if out.get(f) in (None, "", []):
                    out[f] = m.get(f)
            if not out.get("authors"):
                out["authors"] = m.get("authors") or []
            if not out.get("reference_ids"):
                out["reference_ids"] = m.get("reference_ids") or []
            out["keywords"] = list(dict.fromkeys([*out.get("keywords", []), *(m.get("keywords") or [])]))[:15]
        out["arxiv_id"] = next((a for a in (_arxiv_id(m) for m in members) if a), None)
        out["sources"] = list({(m["source"], m["external_id"]): {"provider": m["source"], "external_id": m["external_id"]} for m in members}.values())
        out["pub_types"] = list(dict.fromkeys(t for m in members for t in (m.get("pub_types") or [])))
        out["publication_type"] = _group_type(members)
        out["preprint"] = out["publication_type"] == "preprint"
        out["_ranks"] = {}
        for m in members:
            for prov, r in (m.get("_ranks") or {}).items():
                out["_ranks"][prov] = min(r, out["_ranks"].get(prov, r))
        out["links"] = build_links(out)
        out["primary_link"] = primary_link(out["links"], out["publication_type"])
        notes = list(dict.fromkeys(msg for i in idxs for msg in conflicts.get(i, [])))
        out["verification"] = verify.cross_check(members, out, notes)
        merged.append((min(idxs), out))
    return [p for _, p in sorted(merged, key=lambda t: t[0])]


def _group_type(members: list[dict[str, Any]]) -> str:
    """One type for a merged paper. A journal/review/conference record outranks a preprint copy of the same DOI (it is the published
    version); a preprint is reported only when no member says the paper was published."""
    types = [verify.classify_publication(m.get("pub_types") or [], m.get("doi"), [m["source"]]) for m in members]
    published = [t for t in verify._SPECIFICITY if t != "preprint" and t in types]
    if published:
        return published[0]
    return "preprint" if "preprint" in types else "unknown"


# ----------------------------------------------------------------------------- orchestration
def search_all(query: str, provider_ids: list[str], page: int, per_page: int = 10) -> dict[str, Any]:
    """Run the chosen providers concurrently. Returns results (ranked by unified relevance), per-provider status, unique count, duration."""
    chosen = [BY_ID[i] for i in provider_ids if i in BY_ID]
    t0 = time.perf_counter()

    def run(p: Provider) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        start = time.perf_counter()
        literature.reset_request_stats()
        try:
            res = p.search(query, page, per_page)
            err, kind = None, None
        except LiteratureError as exc:
            res, err, kind = [], str(exc), getattr(exc, "kind", "error")
        except Exception:  # an adapter bug must never take down the other providers
            log.exception("provider %s failed unexpectedly", p.id)
            res, err, kind = [], "Unexpected error while reading this source.", "error"
        requests, retries = literature.request_stats()
        return res, {"provider": p.id, "name": p.name, "ok": err is None, "count": len(res), "error": err, "error_kind": kind,
                     "duration_ms": int((time.perf_counter() - start) * 1000), "requests": requests, "retries": retries}

    with ThreadPoolExecutor(max_workers=max(1, len(chosen))) as pool:
        outcomes = list(pool.map(run, chosen))
    statuses = [st for _, st in outcomes]
    if chosen and not any(st["ok"] for st in statuses):
        raise LiteratureError(" ".join(f"{st['name']}: {st['error']}" for st in statuses))
    flat: list[dict[str, Any]] = []
    depth = max((len(r) for r, _ in outcomes), default=0)
    for rank in range(depth):  # provider order breaks ties; the final order comes from `ranking.rank`
        for (r, st) in outcomes:
            if rank < len(r):
                flat.append({**r[rank], "_ranks": {st["provider"]: rank + 1}})
    n_ok = max(1, sum(1 for st in statuses if st["ok"]))
    results = ranking.rank(query, merge_results(flat), n_providers=n_ok)
    for r in results:
        r.pop("_ranks", None)
        r.pop("pub_types", None)
    return {
        "results": results, "providers": statuses, "total_unique": len(results),
        "duration_ms": int((time.perf_counter() - t0) * 1000),
        "warnings": [f"{st['name']}: {st['error']}" for st in statuses if not st["ok"]],
    }
