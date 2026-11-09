"""Run the real FastAPI app with the upstream scholarly APIs replaced by the test fixtures.

    python -m tests.e2e_server            # serves on :8000

Used for browser end-to-end runs where the network is unavailable. Set E2E_FAIL=pubmed,arxiv to make
those providers fail, or E2E_SLOW=crossref to make a provider time out.
"""
import os

import tests.conftest  # noqa: F401  (prepares env + migrated test database)
import uvicorn

from app.services import literature
from tests.test_discovery import ARXIV_XML, CROSSREF, OA, PUBMED_XML, S2, SPRINGER_JSON

STRESS = os.environ.get("E2E_STRESS") == "1"  # long titles, 40 authors, 150-char DOIs, long URLs: layout stress data for mobile widths
FAIL = set(filter(None, os.environ.get("E2E_FAIL", "").split(",")))
SLOW = set(filter(None, os.environ.get("E2E_SLOW", "").split(",")))


def _name(url: str) -> str:
    for n, frag in (("openalex", "openalex"), ("crossref", "crossref"), ("pubmed", "ncbi"), ("arxiv", "arxiv"),
                    ("semanticscholar", "semanticscholar"), ("springer", "springernature"), ("europepmc", "ebi.ac.uk")):
        if frag in url:
            return n
    raise literature.LiteratureError("unmocked url")


def _gate(n: str) -> None:
    if n in SLOW:
        raise literature.LiteratureTimeout("The literature source did not answer within 10 s.")
    if n in FAIL:
        raise literature.LiteratureError(f"{n} is down")


LONG_DOI = "10.1016/j.neuroimage.2023." + "1234567890" * 12
STRESS_OA = [
    {**OA, "id": "https://openalex.org/W2001", "doi": f"https://doi.org/{LONG_DOI}",
     "title": "Interpretable multi-modal T1-weighted/T2-weighted/FLAIR/diffusion-tensor-imaging-based Alzheimer’s-disease-progression-biomarker-discovery-with-"
              "explainable-deep-learning-pipelines: a systematic evaluation on the Alzheimer’s Disease Neuroimaging Initiative (ADNI) and AIBL cohorts",
     "authorships": [{"author": {"display_name": f"Researcherwithaverylongsurname{i}-Hyphenated Ada{i}"}} for i in range(40)],
     "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/111", "pmcid": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC999"},
     "primary_location": {"landing_page_url": "https://www.sciencedirect.com/science/article/pii/S1053811923000000?via%3Dihub&utm_source=" + "x" * 120,
                          "source": {"type": "journal", "display_name": "Proceedings of the International Conference on Medical Image Computing and Computer-Assisted Intervention Workshops"}},
     "open_access": {"is_oa": True, "oa_url": "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC999&blobtype=pdf"},
     "keywords": [{"display_name": "Computational-neuroscience-and-neuroimaging-methods"}, {"display_name": "Alzheimer disease"}],
     "type": "article", "type_crossref": "journal-article", "cited_by_count": 1234567},
    {**OA, "id": "https://openalex.org/W2002", "doi": "https://doi.org/10.1007/978-3-031-16443-9_3", "title": "Short chapter", "type": "book-chapter",
     "publication_year": 2022, "authorships": [{"author": {"display_name": "Grace Hopper"}}], "primary_location": None, "keywords": [], "cited_by_count": 0},
]
STRESS_PUBMED = ["111"]


def jget(url, params, headers=None):
    n = _name(url)
    _gate(n)
    if n == "openalex":
        if STRESS:
            return {"results": STRESS_OA} if url.endswith("/works") else next(w for w in STRESS_OA if url.endswith(w["id"].rsplit("/", 1)[1]))
        return {"results": [OA]} if url.endswith("/works") else OA
    if n == "springer":
        return SPRINGER_JSON
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


if os.environ.get("E2E_SPRINGER") == "1":
    from app.core.config import get_settings

    get_settings().springer_api_key = "e2e-not-a-real-key"
literature.http_get_json = jget
literature.http_get_text = tget

if __name__ == "__main__":
    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
