"""Real scientific literature from public, key-free APIs: OpenAlex and Europe PMC.

Everything returned here comes from the upstream response. Nothing is invented or filled in:
a missing abstract stays missing. All network access goes through `http_get_json`, the single
function tests replace, so the parsing code is exercised without touching the internet.
"""
import html
import re
import time
from typing import Any

import httpx

from app.core.config import get_settings

OPENALEX = "https://api.openalex.org"
EUROPEPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
SOURCES = ("openalex", "europepmc")


class LiteratureError(Exception):
    """An upstream source failed (timeout, 5xx, bad payload). Message is safe to show."""


class PaperNotFound(LiteratureError):
    pass


class LiteratureTimeout(LiteratureError):
    kind = "timeout"


class LiteratureRateLimited(LiteratureError):
    kind = "rate_limit"


_RETRY_STATUS = {429, 502, 503, 504}


def _request(url: str, params: dict[str, Any], headers: dict[str, str] | None) -> httpx.Response:
    """GET with a few retries and exponential backoff on network errors, 429 and 5xx.

    Error messages never contain the URL or headers, so API keys cannot leak into logs or the UI.
    """
    s = get_settings()
    ua = "ResearchForge/0.4" + (f" (mailto:{s.contact_email})" if s.contact_email else "")
    last: LiteratureError = LiteratureError("unknown error")
    for attempt in range(3):
        try:
            r = httpx.get(url, params=params, timeout=s.literature_timeout_seconds,
                          headers={"User-Agent": ua, **(headers or {})}, follow_redirects=True)
        except httpx.TimeoutException:
            last = LiteratureTimeout(f"The literature source did not answer within {s.literature_timeout_seconds:g} s.")
        except httpx.HTTPError as exc:
            last = LiteratureError(f"Could not reach the literature source ({type(exc).__name__}).")
        else:
            if r.status_code not in _RETRY_STATUS:
                return r
            last = (
                LiteratureRateLimited("The literature source is rate-limiting requests (HTTP 429). Try again shortly.")
                if r.status_code == 429 else LiteratureError(f"The literature source returned HTTP {r.status_code}.")
            )
            ra = r.headers.get("retry-after", "")
            if attempt < 2 and ra.isdigit():
                time.sleep(min(int(ra), 2))
                continue
        if attempt < 2:
            time.sleep(0.4 * 2**attempt)
    raise last


def _checked(r: httpx.Response) -> httpx.Response:
    if r.status_code == 404:
        raise PaperNotFound("Paper not found at the source.")
    if r.status_code >= 400:
        raise LiteratureError(f"The literature source returned HTTP {r.status_code}.")
    return r


def http_get_json(url: str, params: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    r = _checked(_request(url, params, headers))
    try:
        return r.json()
    except ValueError as exc:
        raise LiteratureError("The literature source returned an unreadable response.") from exc


def http_get_text(url: str, params: dict[str, Any], headers: dict[str, str] | None = None) -> str:
    """Second network seam (XML sources). Capped at 5 MB."""
    r = _checked(_request(url, params, headers))
    if len(r.content) > 5_000_000:
        raise LiteratureError("The literature source returned an unexpectedly large response.")
    return r.text


# ----------------------------------------------------------------------------- helpers
def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    v = re.sub(r"^https?://(dx\.)?doi\.org/", "", v)
    return v or None


def _clean(text: str | None) -> str | None:
    if not text:
        return None
    text = re.sub(r"<[^>]+>", "", text)  # Europe PMC abstracts contain simple HTML tags
    text = html.unescape(text)  # Crossref/PubMed titles arrive with entities such as &amp; and &lt;
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def normalize_pmcid(value: Any) -> str | None:
    """'PMC123', 'pmc123', a PMC URL or a bare number -> 'PMC123'; anything else -> None."""
    if value is None or value == "":
        return None
    m = re.search(r"(?i)PMC(\d{1,10})", str(value)) or re.fullmatch(r"(\d{1,10})", str(value).strip())
    return f"PMC{m.group(1)}" if m else None


def _short_id(url_or_id: str) -> str:
    return url_or_id.rstrip("/").rsplit("/", 1)[-1]


def abstract_from_inverted_index(index: dict[str, list[int]] | None) -> str | None:
    """OpenAlex ships abstracts as {word: [positions]}; rebuild the original word order."""
    if not index:
        return None
    slots: dict[int, str] = {}
    for word, positions in index.items():
        for pos in positions:
            slots[pos] = word
    return _clean(" ".join(slots[i] for i in sorted(slots))) if slots else None


# ----------------------------------------------------------------------------- OpenAlex
def parse_openalex_work(w: dict[str, Any]) -> dict[str, Any] | None:
    title = _clean(w.get("title") or w.get("display_name"))
    wid = w.get("id")
    if not title or not wid:
        return None
    loc = w.get("primary_location") or {}
    src = loc.get("source") or {}
    keywords = [k.get("display_name") for k in (w.get("keywords") or []) if k.get("display_name")]
    if not keywords:
        keywords = [t.get("display_name") for t in (w.get("topics") or []) if t.get("display_name")]
    ids = w.get("ids") or {}
    pmid = _short_id(ids["pmid"]) if ids.get("pmid") else None
    doi = normalize_doi(w.get("doi"))
    return {
        "source": "openalex",
        "external_id": _short_id(wid),
        "doi": doi,
        "pmid": pmid,
        "pmcid": normalize_pmcid(ids.get("pmcid")),
        "publisher_url": loc.get("landing_page_url"),
        "title": title,
        "abstract": abstract_from_inverted_index(w.get("abstract_inverted_index")),
        "year": w.get("publication_year"),
        "venue": src.get("display_name"),
        "authors": [a["author"]["display_name"] for a in (w.get("authorships") or []) if (a.get("author") or {}).get("display_name")][:30],
        "url": loc.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else wid),
        "cited_by_count": w.get("cited_by_count"),
        "keywords": keywords[:15],
        "reference_ids": [_short_id(r) for r in (w.get("referenced_works") or [])],
    }


def search_openalex(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"search": query, "per-page": per_page, "page": page}
    if get_settings().contact_email:
        params["mailto"] = get_settings().contact_email
    data = http_get_json(f"{OPENALEX}/works", params)
    return [p for p in (parse_openalex_work(w) for w in (data.get("results") or [])) if p]


def fetch_openalex(external_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"W\d{3,15}", external_id):
        raise PaperNotFound("Unrecognised OpenAlex id.")
    params = {"mailto": get_settings().contact_email} if get_settings().contact_email else {}
    paper = parse_openalex_work(http_get_json(f"{OPENALEX}/works/{external_id}", params))
    if paper is None:
        raise PaperNotFound("Paper not found at the source.")
    return paper


# ----------------------------------------------------------------------------- Europe PMC
def parse_europepmc_record(r: dict[str, Any]) -> dict[str, Any] | None:
    title = _clean(r.get("title"))
    rid, src = r.get("id"), r.get("source")
    if not title or not rid or not src:
        return None
    doi = normalize_doi(r.get("doi"))
    year = r.get("pubYear")
    kws = (r.get("keywordList") or {}).get("keyword") or []
    mesh = [m.get("descriptorName") for m in ((r.get("meshHeadingList") or {}).get("meshHeading") or []) if m.get("descriptorName")]
    authors_raw = r.get("authorString") or ""
    authors = [a.strip() for a in authors_raw.rstrip(".").split(",") if a.strip()][:30]
    return {
        "source": "europepmc",
        "external_id": f"{src}:{rid}",
        "doi": doi,
        "pmid": r.get("pmid"),
        "pmcid": normalize_pmcid(r.get("pmcid")),
        "publisher_url": None,
        "title": title,
        "abstract": _clean(r.get("abstractText")),
        "year": int(year) if str(year).isdigit() else None,
        "venue": r.get("journalTitle") or (r.get("journalInfo") or {}).get("journal", {}).get("title"),
        "authors": authors,
        "url": f"https://europepmc.org/article/{src}/{rid}",
        "cited_by_count": r.get("citedByCount"),
        "keywords": ([k for k in kws if isinstance(k, str)] + mesh)[:15],
        "reference_ids": [],
    }


def search_europepmc(query: str, page: int, per_page: int) -> list[dict[str, Any]]:
    data = http_get_json(
        f"{EUROPEPMC}/search",
        {"query": query, "format": "json", "resultType": "core", "pageSize": per_page, "page": page},
    )
    recs = (data.get("resultList") or {}).get("result") or []
    return [p for p in (parse_europepmc_record(r) for r in recs) if p]


def fetch_europepmc(external_id: str) -> dict[str, Any]:
    m = re.fullmatch(r"([A-Z]{2,4}):([A-Za-z0-9]{1,20})", external_id)
    if not m:
        raise PaperNotFound("Unrecognised Europe PMC id.")
    src, rid = m.groups()
    data = http_get_json(
        f"{EUROPEPMC}/search",
        {"query": f"EXT_ID:{rid} AND SRC:{src}", "format": "json", "resultType": "core", "pageSize": 1},
    )
    recs = (data.get("resultList") or {}).get("result") or []
    paper = parse_europepmc_record(recs[0]) if recs else None
    if paper is None:
        raise PaperNotFound("Paper not found at the source.")
    return paper


# ----------------------------------------------------------------------------- public API
def fetch_paper(source: str, external_id: str) -> dict[str, Any]:
    if source == "openalex":
        return fetch_openalex(external_id)
    if source == "europepmc":
        return fetch_europepmc(external_id)
    raise PaperNotFound("Unknown source.")


def search(query: str, source: str, page: int, per_page: int = 10) -> tuple[list[dict[str, Any]], list[str]]:
    """Returns (results, warnings). With source="all", one failing source becomes a warning."""
    wanted = SOURCES if source == "all" else (source,)
    fns = {"openalex": search_openalex, "europepmc": search_europepmc}
    results: list[dict[str, Any]] = []
    warnings: list[str] = []
    for name in wanted:
        try:
            results.extend(fns[name](query, page, per_page))
        except LiteratureError as exc:
            warnings.append(f"{'OpenAlex' if name == 'openalex' else 'Europe PMC'}: {exc}")
    if not results and len(warnings) == len(wanted):
        raise LiteratureError(" ".join(warnings))
    # merge duplicates across sources by DOI, keeping the first (OpenAlex carries reference lists)
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for p in results:
        key = p["doi"] or f"{p['source']}:{p['external_id']}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(p)
    return merged, warnings
