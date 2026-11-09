export type SourceType = "source_metadata" | "rule_extracted" | "ai_extracted" | "researcher_confirmed" | "researcher_entered";
export type Verification = "unverified" | "source_reported" | "confirmed" | "edited" | "rejected";
export type MemoryType = "research_identity" | "literature" | "experiment_context";
export type EvidenceRelationship = "supports" | "contradicts" | "contextualizes" | "neutral";
export type ClaimType = "finding" | "hypothesis" | "method" | "background";
export type GapCategory = "methodological" | "dataset" | "population" | "evaluation" | "reproducibility" | "conflicting_findings" | "unanswered_question" | "hypothesis_to_validate";
export type DecisionType = "method_selected" | "method_rejected" | "dataset_choice" | "evaluation_strategy" | "inclusion_exclusion" | "scope_change" | "other";

export interface PaperRef {
  id: number;
  title: string;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  source: string;
  year: number | null;
  in_project: boolean;
  url: string | null;
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface MemoryEntry {
  id: number;
  paper_id: number | null;
  memory_type: MemoryType;
  field: string;
  title: string;
  content: string;
  origin: "auto" | "researcher";
  source_type: SourceType;
  source_reference: string | null;
  extraction_method: string | null;
  matched_text: string | null;
  section_name: string | null;
  page_number: number | null;
  extracted_at: string | null;
  verification_status: Verification;
  confidence: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  paper: PaperRef | null;
}

export interface Evidence {
  id: number;
  claim_id: number;
  paper_id: number;
  relationship: EvidenceRelationship;
  evidence_kind: "quote" | "paraphrase";
  quoted_text: string;
  section_name: string | null;
  page_number: number | null;
  source_url: string | null;
  verification_status: "source_matched" | "unverified" | "confirmed";
  created_at: string;
  paper: PaperRef | null;
}

export interface Claim {
  id: number;
  claim_text: string;
  claim_type: ClaimType;
  origin: string;
  status: "active" | "retracted";
  confidence: number | null;
  created_at: string;
  updated_at: string;
  evidence: Evidence[];
  contested: boolean;
}

export interface Gap {
  id: number;
  title: string;
  description: string;
  gap_category: GapCategory;
  evidence_summary: string | null;
  researcher_comment: string | null;
  status: "potential" | "validated" | "dismissed";
  confidence: number | null;
  created_at: string;
  updated_at: string;
  notice: string;
}

export interface Decision {
  id: number;
  supersedes_id: number | null;
  decision_type: DecisionType;
  description: string;
  rationale: string | null;
  status: "active" | "rejected" | "superseded";
  created_at: string;
  updated_at: string;
}

export interface MemoryEvent {
  id: number;
  event_type: string;
  actor: "system" | "researcher";
  subject_type: string | null;
  subject_id: number | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface MemoryConflict {
  kind: "contested_claim" | "metric_variation";
  note: string;
  claim_id?: number;
  claim_text?: string;
  metric?: string;
  supports?: { paper: string; quoted_text: string }[];
  contradicts?: { paper: string; quoted_text: string }[];
  values?: { paper: string; value: string; source_sentence: string | null; datasets_named_in_paper: string[] }[];
}

export interface MemoryOverview {
  project_id: number;
  research_question: string;
  disease: string;
  modality: string;
  objectives: string[];
  version: number;
  summary: string | null;
  last_rebuilt_at: string | null;
  last_updated_at: string | null;
  counts: {
    entries: number;
    confirmed: number;
    unverified: number;
    rejected: number;
    claims: number;
    evidence: number;
    decisions: number;
    gaps: number;
    saved_papers: number;
    by_source: Record<SourceType, number>;
  };
  conflicts: MemoryConflict[];
  not_extracted: string[];
  notice: string;
}

export interface RebuildResult {
  created: number;
  removed_stale: number;
  papers_processed: number;
  version: number;
}
