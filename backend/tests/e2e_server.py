"""Run the real FastAPI app with the upstream scholarly APIs replaced by the test fixtures.

    python -m tests.e2e_server            # serves on :8000

Used for browser end-to-end runs where the network is unavailable. Set E2E_FAIL=pubmed,arxiv to make
those providers fail, or E2E_SLOW=crossref to make a provider time out.
"""
import os

import tests.conftest  # noqa: F401  (prepares env + migrated test database)
import uvicorn

from app.services import literature
from tests.test_discovery import ARXIV_XML, CROSSREF, OA, PUBMED_XML, S2

FAIL = set(filter(None, os.environ.get("E2E_FAIL", "").split(",")))
SLOW = set(filter(None, os.environ.get("E2E_SLOW", "").split(",")))


def _name(url: str) -> str:
    for n, frag in (("openalex", "openalex"), ("crossref", "crossref"), ("pubmed", "ncbi"), ("arxiv", "arxiv"),
                    ("semanticscholar", "semanticscholar"), ("europepmc", "ebi.ac.uk")):
        if frag in url:
            return n
    raise literature.LiteratureError("unmocked url")


def _gate(n: str) -> None:
    if n in SLOW:
        raise literature.LiteratureTimeout("The literature source did not answer within 10 s.")
    if n in FAIL:
        raise literature.LiteratureError(f"{n} is down")


def jget(url, params, headers=None):
    n = _name(url)
    _gate(n)
    if n == "openalex":
        return {"results": [OA]} if url.endswith("/works") else OA
    if n == "crossref":
        return CROSSREF if url.endswith("/works") else {"message": CROSSREF["message"]["items"][0]}
    if n == "pubmed":
        return {"esearchresult": {"idlist": ["111", "222"]}}
    if n == "semanticscholar":
        return S2 if url.endswith("/search") else S2["data"][0]
    return {"resultList": {"result": []}}


def tget(url, params):
    n = _name(url)
    _gate(n)
    return PUBMED_XML if n == "pubmed" else ARXIV_XML


literature.http_get_json = jget
literature.http_get_text = tget

if __name__ == "__main__":
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
