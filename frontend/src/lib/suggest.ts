import type { Disease, Modality } from "@/types/project";

export interface Suggestion {
  modality?: Modality;
  disease?: Disease;
}

/**
 * Simple keyword matching (not an ML model): reads the question text and proposes
 * a modality / domain. The user always confirms with a click.
 */
export function suggestFromQuestion(q: string): Suggestion {
  const t = q.toLowerCase();
  const out: Suggestion = {};

  if (/\bfmri\b|functional mri|resting[- ]state|bold signal/.test(t)) out.modality = "fMRI";
  else if (/\bdti\b|diffusion|tractograph/.test(t)) out.modality = "DTI";
  else if (/\bpet\b|amyloid|tau pet|fdg/.test(t)) out.modality = "PET";
  else if (/\bt2\b|t2-weighted|flair/.test(t)) out.modality = "T2-weighted MRI";
  else if (/\bt1\b|t1-weighted|structural mri|\bsmri\b/.test(t)) out.modality = "T1-weighted MRI";
  else if (/\bct\b|computed tomography/.test(t)) out.modality = "CT";

  if (/alzheimer|\bmci\b|dementia|hippocamp|\badni\b/.test(t)) out.disease = "Alzheimer's Disease";
  else if (/autis|\basd\b|\babide\b/.test(t)) out.disease = "Autism Spectrum Disorder";
  else if (/tumou?r|glioma|glioblastoma|\bbrats\b/.test(t)) out.disease = "Brain Tumor";
  else if (/parkinson|epilep|multiple sclerosis|stroke|schizophren/.test(t)) out.disease = "Neurological Disorders";

  return out;
}

export const EXAMPLE_QUESTION =
  "Can T1-weighted MRI improve early Alzheimer's detection using interpretable regional biomarkers?";
