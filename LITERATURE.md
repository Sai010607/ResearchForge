# Literature discovery

Search is a metadata and abstract search. **No full text is retrieved**; every provider reports `supports_full_text: false`.

| Provider | Key | Notes |
|---|---|---|
| OpenAlex | none (`CONTACT_EMAIL` recommended) | reference lists feed citation links between saved papers |
| PubMed (NCBI E-utilities) | optional `NCBI_API_KEY` | abstracts, MeSH, PMCID; no citation counts |
| Europe PMC | none | PMID/PMCID, preprints (`PPR:` ids) |
| Crossref | none (`CONTACT_EMAIL` recommended) | DOI metadata, publisher URL |
| arXiv | none | preprints only, about 1 request per 3 s |
| Springer Nature | **required** `SPRINGER_API_KEY` (or `SPRINGER_OA_API_KEY`) | Meta v2 API (`/meta/v2/json`), or the Open Access API when only an OA key is set. Off until a key exists. Records without a DOI are skipped. |
| Semantic Scholar | optional `SEMANTIC_SCHOLAR_API_KEY` | off by default without a key (shared rate-limited pool) |

Every provider runs concurrently with its own timeout (`LITERATURE_TIMEOUT_SECONDS`, 10 s), up to 3 attempts with exponential backoff on network errors, 429 and 5xx, and its own status in the response. One failing provider never blocks the others.

## De-duplication
Records are merged by DOI, then PMID, PMCID, arXiv id. As a weaker last step, identical normalised title (25+ characters) AND the same year AND an overlapping first-author name. Title alone never merges. The merged card keeps every provider record (`sources`) and fills gaps from lower-priority providers; it never overwrites a value the primary provider gave. `total_unique` counts merged papers, not the sum of provider counts.

## Links
Links (DOI, PubMed, PMC, arXiv, publisher page, Europe PMC, OpenAlex, Semantic Scholar) are built by the server from identifiers the source returned. Check them against the live services with:

    python -m app.scripts.check_links "alzheimer MRI biomarkers"

It confirms that each identifier points at the same paper (title match, PMC-to-PMID/DOI mapping, doi.org handle) and reports HTTP status. Some sites (publishers, Europe PMC) answer HTTP 403 to scripts; that is reported as "blocks bots", not as a broken link.

## Not built yet
Filters (year, type, open access), CORE, OpenAIRE, bioRxiv/medRxiv, DBLP, OpenReview, DataCite/Zenodo, Unpaywall and full-text resolution, screening, evidence matrix, synthesis. Rule-based tags are a navigation aid, not extracted facts.

## Quality layer (links, ranking, verification, types)

**Links.** Built only from identifiers the source supplied. Kinds: `pmc`, `fulltext` (open-access copy from OpenAlex / Semantic Scholar / Springer OA), `publisher`, `doi`, `pubmed`, `arxiv`, `europepmc`, `openalex`, `semanticscholar`. A source-supplied "landing page" is shown as *Publisher page* only if it is an http(s) URL that is not an index/aggregator/repository (doi.org, NCBI, Europe PMC, arXiv, repositories...). The server picks one primary action (`primary_link`): free full text (PMC, OA copy, arXiv) → DOI → publisher page → PubMed → other records, Europe PMC last (its pages can fail for brand-new records).

**Ranking.** One score per merged paper (`services/ranking.py`): title/abstract/keyword term coverage, phrase adjacency, exact title, authors, domain concepts, small consensus/provider-rank/citation priors. Gated by term coverage, so one matching word of four cannot rank a paper highly. Ranking is within each fetched page; "Load more" appends the next page.

**Verification.** (1) Every result carries `verification` (cross-source agreement; no extra network). Records are never merged when identifiers conflict (same DOI, different PMID, etc.), when a shared identifier sits on clearly different titles/years, or when a preprint DOI and a journal DOI differ; conflicts are shown, not resolved. (2) `GET /api/literature/verify` asks Crossref (DOI), PubMed (PMID), the NCBI ID converter (PMCID↔PMID↔DOI) and arXiv, comparing title, year and first author.

**Publication type.** From each provider's own type field (never from the title): journal article, review, conference paper, book chapter, book, preprint, other, or "not stated".

**Live QA.** `python -m app.scripts.check_links "query" [--only springer]` runs the identifier checks and follows every redirect of every link (dead page, redirect to a home page, "not found" served as 200, title found on the page). Sites that answer 403 to scripts are reported as "blocked", never as verified.

**Tests.** Backend `pytest`; frontend `npm test`; mobile layout `npm run test:e2e` (needs `npx playwright install chromium` once; backend is mocked).
