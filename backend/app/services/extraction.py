"""Rule-based metadata extraction from a paper's own title, abstract and keywords.

This is deliberately NOT an LLM: it is deterministic keyword matching, and every extracted tag
records the exact text it matched and where, so a researcher can verify it. It will miss papers
that describe things in unusual words — treat the tags as a navigation aid, not ground truth.
"""
import re
from typing import Any

METHOD = "rule-based keyword matching on title, abstract and keywords"

# canonical value -> regex alternatives (matched case-insensitively on word boundaries)
MODALITIES: dict[str, list[str]] = {
    "T1-weighted MRI": [r"t1[- ]?weighted", r"\bt1w\b"],
    "T2-weighted MRI": [r"t2[- ]?weighted", r"\bt2w\b", r"\bflair\b"],
    "fMRI": [r"\bfmri\b", r"functional (?:magnetic resonance|mri)", r"resting[- ]state"],
    "DTI": [r"\bdti\b", r"diffusion tensor", r"diffusion (?:mri|weighted)", r"tractography"],
    "PET": [r"\bpet\b", r"positron emission"],
    "CT": [r"\bct\b", r"computed tomography"],
    "MRI": [r"\bmri\b", r"magnetic resonance imaging", r"structural mri"],
}
DISEASES: dict[str, list[str]] = {
    "Alzheimer's Disease": [r"alzheimer", r"\bmci\b", r"mild cognitive impairment"],
    "Autism Spectrum Disorder": [r"autism", r"\basd\b"],
    "Brain Tumor": [r"glioma", r"glioblastoma", r"brain tumou?r", r"meningioma"],
    "Parkinson's Disease": [r"parkinson"],
    "Schizophrenia": [r"schizophreni"],
    "Multiple Sclerosis": [r"multiple sclerosis"],
    "Epilepsy": [r"epilep"],
    "Stroke": [r"\bstroke\b", r"ischemic"],
    "Depression": [r"major depress", r"depressive disorder"],
}
DATASETS: dict[str, list[str]] = {
    "ADNI": [r"\badni\b", r"alzheimer'?s disease neuroimaging initiative"],
    "ABIDE": [r"\babide\b", r"autism brain imaging data exchange"],
    "OASIS": [r"\boasis\b"],
    "HCP": [r"\bhcp\b", r"human connectome project"],
    "UK Biobank": [r"uk biobank"],
    "BraTS": [r"\bbrats\b"],
    "IXI": [r"\bixi\b"],
    "PPMI": [r"\bppmi\b"],
    "OpenNeuro": [r"openneuro"],
    "AIBL": [r"\baibl\b"],
}
METHODS: dict[str, list[str]] = {
    "Convolutional neural network": [r"convolutional neural network", r"\bcnns?\b", r"3d[- ]cnn"],
    "Graph neural network": [r"graph neural network", r"graph convolution", r"\bgcns?\b", r"\bgnns?\b"],
    "Transformer": [r"transformer", r"vision transformer", r"\bvit\b"],
    "U-Net": [r"u-?net"],
    "Support vector machine": [r"support vector machine", r"\bsvm\b", r"support vector regression", r"\bsvr\b"],
    "Random forest": [r"random forest"],
    "Logistic regression": [r"logistic regression"],
    "Autoencoder": [r"autoencoder"],
    "Generative adversarial network": [r"generative adversarial", r"\bgans?\b"],
    "Gradient boosting": [r"xgboost", r"gradient boosting", r"lightgbm"],
    "Radiomics": [r"radiomic"],
    "Explainable AI": [r"explainab", r"interpretab", r"grad-?cam", r"\bshap\b", r"saliency"],
    "Deep learning": [r"deep learning"],
}


def _find(groups: dict[str, list[str]], fields: dict[str, str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for value, patterns in groups.items():
        hit = None
        for field, text in fields.items():
            for pat in patterns:
                m = re.search(pat, text, flags=re.IGNORECASE)
                if m:
                    hit = {"value": value, "matched": m.group(0), "field": field}
                    break
            if hit:
                break
        if hit:
            out.append(hit)
    return out


def extract_metadata(title: str, abstract: str | None, keywords: list[str]) -> dict[str, Any]:
    fields = {"title": title or "", "abstract": abstract or "", "keywords": "; ".join(keywords or [])}
    modalities = _find(MODALITIES, fields)
    # "MRI" is only useful when nothing more specific matched
    if len(modalities) > 1:
        modalities = [m for m in modalities if m["value"] != "MRI"]
    return {
        "method": METHOD,
        "modalities": modalities,
        "diseases": _find(DISEASES, fields),
        "datasets": _find(DATASETS, fields),
        "methods": _find(METHODS, fields),
        "abstract_available": bool(abstract),
    }
