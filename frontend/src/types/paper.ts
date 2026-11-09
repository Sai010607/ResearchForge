export type ProviderId = "openalex" | "pubmed" | "europepmc" | "crossref" | "semanticscholar" | "arxiv" | "springer";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  group: "general" | "biomedical" | "cs";
  requires_key: boolean;
  supports_key: boolean;
  key_configured: boolean;
  default_enabled: boolean;
  supports_full_text: boolean;
  rate_limit: string;
  docs: string;
  env_var: string | null;
}

export interface PaperLink {
  kind: string;
  label: string;
  url: string;
}

/** The single "open" action the server chose: free full text first, then publisher, then abstract / record pages. */
export interface PrimaryLink extends PaperLink {
  access: "full_text" | "publisher" | "abstract" | "record";
}

export type PublicationType = "journal_article" | "review" | "conference_paper" | "book_chapter" | "book" | "preprint" | "other" | "unknown";

export interface VerificationCheck {
  id: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
}

/** Agreement between the provider records merged into one result (computed without extra network calls). */
export interface Verification {
  status: "cross_checked" | "single_source" | "warning" | "conflict";
  sources_agreeing: number;
  checks: VerificationCheck[];
}

/** Result of asking each identifier's registry (Crossref, PubMed, NCBI ID converter, arXiv) about a paper. */
export interface IdentifierCheck {
  source: string;
  external_id: string;
  status: "verified" | "warning" | "conflict" | "unchecked";
  checks: VerificationCheck[];
}

export interface MatchInfo {
  terms: number;
  terms_found: number;
  missing_terms: string[];
  in_title: number;
  exact_title: boolean;
  phrase_found: boolean;
}

export interface ProviderStatus {
  provider: string;
  name: string;
  ok: boolean;
  count: number;
  error: string | null;
  error_kind?: "timeout" | "rate_limit" | "not_configured" | "error" | null;
  duration_ms: number;
  /** HTTP requests the provider made for this search, and how many of them were automatic retries */
  requests?: number;
  retries?: number;
}

export interface SourceRef {
  provider: string;
  external_id: string;
}

export interface ExtractedTag {
  value: string;
  matched: string;
  field: "title" | "abstract" | "keywords";
}

export interface ExtractedMetadata {
  method?: string;
  modalities?: ExtractedTag[];
  diseases?: ExtractedTag[];
  datasets?: ExtractedTag[];
  methods?: ExtractedTag[];
  abstract_available?: boolean;
}

/** A publication exactly as the source returned it (search result, not yet saved). */
export interface PaperHit {
  source: string;
  external_id: string;
  doi: string | null;
  pmid: string | null;
  pmcid?: string | null;
  publisher_url?: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: string[];
  url: string | null;
  cited_by_count: number | null;
  keywords: string[];
  extracted: ExtractedMetadata;
  arxiv_id?: string | null;
  /** every provider record that was merged into this result */
  sources?: SourceRef[];
  preprint?: boolean;
  /** DOI / PubMed / PMC / arXiv / publisher / source-page links built by the server from the stored ids */
  links?: PaperLink[];
  primary_link?: PrimaryLink | null;
  oa_url?: string | null;
  publication_type?: PublicationType | null;
  /** unified 0..1 relevance for the query (search results only) */
  relevance?: number | null;
  match?: MatchInfo | null;
  verification?: Verification | null;
}

export interface Paper extends PaperHit {
  id: number;
  project_ids: number[];
  /** ids of other saved papers this one cites */
  cites: number[];
}

export interface LiteratureSearch {
  query: string;
  source: string;
  page: number;
  results: PaperHit[];
  warnings: string[];
  providers: ProviderStatus[];
  /** unique papers in this response after deduplication */
  total_unique: number;
  duration_ms: number;
}
