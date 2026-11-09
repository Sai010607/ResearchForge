"""Live smoke test of the literature sources (run on YOUR machine or the Render shell).

    python -m app.scripts.check_literature "alzheimer MRI biomarkers"

Prints what every provider (OpenAlex, PubMed, Europe PMC, Crossref, arXiv, Semantic Scholar) really returns, using the same parsing code the API uses.
Exit code 1 if a source fails or returns something unparseable.
"""
import sys

from app.services import discovery, literature
from app.services.extraction import extract_metadata


def main() -> int:
    query = " ".join(sys.argv[1:]) or "alzheimer MRI biomarkers"
    ok = True
    for p in discovery.PROVIDERS:
        name, fn = p.name, p.search
        try:
            papers = fn(query, 1, 3)
        except literature.LiteratureError as exc:
            # Semantic Scholar without a key is often rate-limited: report, but do not fail the run
            print(f"[{'WARN' if p.id == 'semanticscholar' else 'FAIL'}] {name}: {exc}")
            ok = ok and p.id == 'semanticscholar'
            continue
        print(f"[ OK ] {name}: {len(papers)} results for {query!r}")
        for p in papers:
            x = extract_metadata(p["title"], p["abstract"], p["keywords"])
            tags = [t["value"] for k in ("modalities", "datasets", "methods") for t in x[k]]
            print(f"   - {p['year']} | {p['title'][:90]}")
            print(f"     id={p['external_id']} doi={p['doi']} abstract={'yes' if p['abstract'] else 'no'} refs={len(p['reference_ids'])} tags={tags}")
        if not papers and p.id != 'semanticscholar':
            ok = False
    # prove "save by id" round-trips for the first OpenAlex hit
    try:
        first = literature.search_openalex(query, 1, 1)[0]
        again = literature.fetch_paper("openalex", first["external_id"])
        print(f"[ OK ] fetch by id {first['external_id']}: {'title matches' if again['title'] == first['title'] else 'TITLE DIFFERS'}")
    except Exception as exc:  # noqa: BLE001 - diagnostic tool
        print(f"[FAIL] fetch by id: {exc}")
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
