export const MODALITIES = ["T1-weighted MRI", "T2-weighted MRI", "fMRI", "DTI", "PET", "CT", "Other"] as const;
export const DISEASES = [
  "Alzheimer's Disease",
  "Autism Spectrum Disorder",
  "Brain Tumor",
  "Neurological Disorders",
  "General Medical Imaging",
  "Other",
] as const;
export const OBJECTIVES = [
  "Early Detection",
  "Biomarker Identification",
  "Model Interpretability",
  "Classification",
  "Prediction",
  "Explainability",
] as const;

export type Modality = (typeof MODALITIES)[number];
export type Disease = (typeof DISEASES)[number];
export type Objective = (typeof OBJECTIVES)[number];

export interface ProjectInput {
  research_question: string;
  modality: Modality;
  disease: Disease;
  objectives: Objective[];
}

export interface Project extends ProjectInput {
  id: number;
  created_at: string;
  updated_at: string;
}
