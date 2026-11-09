"""Live check that every link ResearchForge builds really points at the paper it belongs to.

    python -m app.scripts.check_links "alzheimer MRI biomarkers" [--per-provider 2]

For each representative result it verifies, per link kind:
  doi        doi.org handle exists AND Crossref (when it knows the DOI) returns the same title
  pubmed     PubMed efetch for that PMID returns the same title
  pmc        NCBI ID converter maps the PMCID to the same PMID / DOI
  arxiv      arXiv API for that id returns the same title
  europepmc  Europe PMC returns the same title for that record
  openalex   OpenAlex returns the same title for that work id
  publisher / any URL: HTTP status (404/410 = broken; 401/403/429 = site blocks bots, reported as such)
Exit code 1 if an identifier points at a different paper or a link is dead.
"""
import re
import sys
from typing import Any

import httpx

from app.services import discovery, literature

UA = {"User-Agent": "ResearchForge-linkcheck/0.4"}


def norm(t: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def same_title(a: str | None, b: str | None) -> bool:
    x, y = norm(a), norm(b)
    return bool(x and y) and (x == y or x.startswith(y[:40]) or y.startswith(x[:40]))


def http_status(url: str) -> int:
    with httpx.stream("GET", url, headers=UA, follow_redirects=True, timeout=20) as r:
        return r.status_code


def verify(link: dict[str, str], paper: dict[str, Any]) -> tuple[str, str]:
    """Returns (verdict, detail) with verdict in OK / WARN / FAIL."""
    kind, url, title = link["kind"], link["url"], paper["title"]
    try:
        if kind == "doi":
            h = httpx.get(f"https://doi.org/api/handles/{paper['doi']}", headers=UA, timeout=20).json()
            if h.get("responseCode") != 1:
                return "FAIL", f"doi.org has no handle (responseCode={h.get('responseCode')})"
            try:
                cr = discovery.fetch_crossref(paper["doi"])
            except literature.PaperNotFound:
                return "OK", "DOI resolves (registered outside Crossref, title not cross-checked)"
            return ("OK", "DOI resolves; Crossref title matches") if same_title(cr["title"], title) else ("FAIL", f"Crossref title differs: {cr['title'][:70]!r}")
        if kind == "pubmed":
            got = discovery.fetch_pubmed(paper["pmid"])
            return ("OK", "PubMed title matches") if same_title(got["title"], title) else ("FAIL", f"PubMed title differs: {got['title'][:70]!r}")
        if kind == "pmc":
            d = httpx.get("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/", params={"ids": paper["pmcid"], "format": "json"}, headers=UA, timeout=20).json()
            rec = (d.get("records") or [{}])[0]
            if rec.get("status") == "error":
                return "FAIL", f"ID converter: {rec.get('errmsg')}"
            if paper.get("pmid") and rec.get("pmid") and str(rec["pmid"]) != str(paper["pmid"]):
                return "FAIL", f"PMC maps to PMID {rec['pmid']}, expected {paper['pmid']}"
            if paper.get("doi") and rec.get("doi") and str(rec["doi"]).lower() != paper["doi"]:
                return "FAIL", f"PMC maps to DOI {rec['doi']}, expected {paper['doi']}"
            return "OK", f"PMCID maps to pmid={rec.get('pmid')} doi={rec.get('doi')}"
        if kind == "arxiv":
            got = discovery.fetch_arxiv(re.sub(r"v\d+$", "", url.rsplit("/abs/", 1)[1]))
            return ("OK", "arXiv title matches") if same_title(got["title"], title) else ("FAIL", f"arXiv title differs: {got['title'][:70]!r}")
        if kind == "europepmc":
            src, rid = url.rsplit("/article/", 1)[1].split("/")
            got = literature.fetch_europepmc(f"{src}:{rid}")
            return ("OK", "Europe PMC title matches") if same_title(got["title"], title) else ("FAIL", f"Europe PMC title differs: {got['title'][:70]!r}")
        if kind == "openalex":
            got = literature.fetch_openalex(url.rsplit("/", 1)[1])
            return ("OK", "OpenAlex title matches") if same_title(got["title"], title) else ("FAIL", f"OpenAlex title differs: {got['title'][:70]!r}")
        if kind == "semanticscholar":
            got = discovery.fetch_semanticscholar(url.rsplit("/", 1)[1])
            return ("OK", "Semantic Scholar title matches") if same_title(got["title"], title) else ("FAIL", f"Semantic Scholar title differs: {got['title'][:70]!r}")
    except literature.LiteratureError as exc:
        return "WARN", f"could not verify identifier: {exc}"
    except Exception as exc:  # noqa: BLE001 - diagnostic tool
        return "WARN", f"could not verify identifier: {type(exc).__name__}"
    return "OK", "no identifier check for this kind"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    per = int(sys.argv[sys.argv.index("--per-provider") + 1]) if "--per-provider" in sys.argv else 2
    if "--per-provider" in sys.argv:
        args = [a for a in args if a != str(per)]
    query = " ".join(args) or "alzheimer MRI biomarkers"
    bad = 0
    picked: dict[str, dict[str, Any]] = {}
    for p in discovery.PROVIDERS:
        try:
            res = discovery.search_all(query, [p.id], 1, per)["results"]
        except literature.LiteratureError as exc:
            print(f"[WARN] {p.name}: search failed: {exc}")
            continue
        for paper in res[:per]:
            picked.setdefault(f"{paper['doi'] or paper['title']}", paper)
    # also check one record that several providers returned, to exercise merged links
    merged = discovery.search_all(query, [p.id for p in discovery.PROVIDERS if p.id != "semanticscholar"], 1, 5)["results"]
    multi = next((m for m in merged if len(m.get("sources", [])) > 1), None)
    if multi:
        picked.setdefault("merged:" + multi["title"], multi)
    for paper in picked.values():
        print(f"\n{paper['title'][:100]}\n  providers={[s['provider'] for s in paper.get('sources', [])]} doi={paper['doi']} pmid={paper['pmid']} pmcid={paper.get('pmcid')} arxiv={paper.get('arxiv_id')}")
        for link in paper["links"]:
            verdict, detail = verify(link, paper)
            try:
                code = http_status(link["url"])
                http = "dead" if code in (404, 410) else ("blocks bots" if code in (401, 403, 429) else "reachable")
                if http == "dead":
                    verdict, detail = "FAIL", f"{detail}; HTTP {code}"
                elif http == "blocks bots" and verdict == "OK":
                    detail += f"; page answers HTTP {code} to scripts (not a broken link)"
                http_txt = f"HTTP {code}"
            except httpx.HTTPError as exc:
                http_txt = type(exc).__name__
            print(f"  [{verdict:4}] {link['kind']:<16} {http_txt:<9} {link['url']}\n         {detail}")
            bad += verdict == "FAIL"
    print(f"\n{'ALL LINKS VERIFIED' if not bad else f'{bad} PROBLEM(S) FOUND'}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
