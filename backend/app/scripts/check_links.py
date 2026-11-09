"""Live check that every link ResearchForge builds really lands on the paper it belongs to.

    python -m app.scripts.check_links "alzheimer MRI biomarkers" [--per-provider 2] [--only springer]

Two independent checks per result:
  1. IDENTIFIERS  verify.check_identifiers: Crossref (DOI), PubMed (PMID), NCBI ID converter (PMCID<->PMID<->DOI), arXiv, compared
                  by title / year / first author with the record we show.
  2. LANDING PAGE linkprobe.probe: follows every redirect of every link and judges the FINAL page (dead, generic home page,
                  "not found" served as 200, or title found on the page). Sites that refuse scripts (HTTP 403) are reported as
                  "blocked", never as broken or as verified.
Exit code 1 if an identifier points at a different paper, or a link is dead / redirects to a home page / is a soft 404.
"""
import sys
from typing import Any

from app.services import discovery, linkprobe, literature, verify

BAD_PROBE = {"dead", "generic_redirect", "soft_404"}


def pick(query: str, per: int, only: str | None) -> dict[str, dict[str, Any]]:
    picked: dict[str, dict[str, Any]] = {}
    for p in discovery.PROVIDERS:
        if only and p.id != only:
            continue
        try:
            res = discovery.search_all(query, [p.id], 1, per)["results"]
        except literature.LiteratureError as exc:
            print(f"[WARN] {p.name}: search failed: {exc}")
            continue
        for paper in res[:per]:
            picked.setdefault(paper["doi"] or paper["title"], paper)
    if not only:  # one record that several providers returned, to exercise merged links
        ids = [p.id for p in discovery.PROVIDERS if p.id != "semanticscholar"]
        try:
            multi = next((m for m in discovery.search_all(query, ids, 1, 5)["results"] if len(m.get("sources", [])) > 1), None)
        except literature.LiteratureError:
            multi = None
        if multi:
            picked.setdefault("merged:" + multi["title"], multi)
    return picked


def main() -> int:
    argv = sys.argv[1:]
    per = int(argv[argv.index("--per-provider") + 1]) if "--per-provider" in argv else 2
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    skip = {i + 1 for i, a in enumerate(argv) if a in ("--per-provider", "--only")}
    words = [a for i, a in enumerate(argv) if not a.startswith("--") and i not in skip]
    query = " ".join(words) or "alzheimer MRI biomarkers"
    bad = 0
    tally = {"checked": 0, "ok": 0, "blocked": 0, "unverified": 0, "problems": 0}
    for paper in pick(query, per, only).values():
        print(f"\n{paper['title'][:100]}\n  type={paper.get('publication_type')} providers={[s['provider'] for s in paper.get('sources', [])]} "
              f"doi={paper['doi']} pmid={paper['pmid']} pmcid={paper.get('pmcid')} arxiv={paper.get('arxiv_id')}")
        pl = paper.get("primary_link")
        print(f"  primary action: {pl['label']} -> {pl['url']}" if pl else "  primary action: none")
        ident = verify.check_identifiers(paper)
        print(f"  identifiers: {ident['status'].upper()}")
        for c in ident["checks"]:
            print(f"    [{c['status']:<4}] {c['detail']}")
            if c["status"] == "fail":
                bad += 1
                tally["problems"] += 1
        for link in paper["links"]:
            r = linkprobe.probe(link["url"], paper["title"])
            tally["checked"] += 1
            if r["verdict"] in BAD_PROBE:
                bad += 1
                tally["problems"] += 1
                mark = "FAIL"
            elif r["verdict"] == "ok":
                tally["ok"] += 1
                mark = "OK"
            else:
                tally["blocked" if r["verdict"] == "blocked" else "unverified"] += 1
                mark = "??"
            final = "" if r["final_url"] == link["url"] else f"\n           -> landed on {r['final_url']}"
            print(f"  [{mark:<4}] {link['kind']:<16} {r['verdict']:<16} HTTP {r['status']}  {link['url']}{final}\n           {r['detail']}")
    print(f"\nLinks checked: {tally['checked']} · landed on the right page: {tally['ok']} · site blocks scripts (not judged): {tally['blocked']} · "
          f"page loaded but title not in HTML (not judged): {tally['unverified']} · PROBLEMS: {tally['problems']}")
    print("ALL CHECKED LINKS AND IDENTIFIERS ARE CONSISTENT" if not bad else f"{bad} PROBLEM(S) FOUND")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
