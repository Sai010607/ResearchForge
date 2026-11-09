export type LiteratureSource = "all" | "openalex" | "europepmc";

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
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: string[];
  url: string | null;
  cited_by_count: number | null;
  keywords: string[];
  extracted: ExtractedMetadata;
}

export interface Paper extends PaperHit {
  id: number;
  project_ids: number[];
  /** ids of other saved papers this one cites */
  cites: number[];
}

export interface LiteratureSearch {
  query: string;
  source: LiteratureSource;
  page: number;
  results: PaperHit[];
  warnings: string[];
}
