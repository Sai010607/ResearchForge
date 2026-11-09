# Literature discovery

Search is a metadata and abstract search. **No full text is retrieved**; every provider reports `supports_full_text: false`.

| Provider | Key | Notes |
|---|---|---|
| OpenAlex | none (`CONTACT_EMAIL` recommended) | reference lists feed citation links between saved papers |
| PubMed (NCBI E-utilities) | optional `NCBI_API_KEY` | abstracts, MeSH, PMCID; no citation counts |
| Europe PMC | none | PMID/PMCID, preprints (`PPR:` ids) |
| Crossref | none (`CONTACT_EMAIL` recommended) | DOI metadata, publisher URL |
| arXiv | none | preprints only, about 1 request per 3 s |
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
