from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Modality = Literal["T1-weighted MRI", "T2-weighted MRI", "fMRI", "DTI", "PET", "CT", "Other"]
Disease = Literal[
    "Alzheimer's Disease",
    "Autism Spectrum Disorder",
    "Brain Tumor",
    "Neurological Disorders",
    "General Medical Imaging",
    "Other",
]
Objective = Literal[
    "Early Detection",
    "Biomarker Identification",
    "Model Interpretability",
    "Classification",
    "Prediction",
    "Explainability",
]


class ProjectBase(BaseModel):
    research_question: str = Field(min_length=10, max_length=2000)
    modality: Modality
    disease: Disease
    objectives: list[Objective] = Field(min_length=1)

    @field_validator("research_question")
    @classmethod
    def strip_question(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 10:
            raise ValueError("research_question must be at least 10 characters")
        return v

    @field_validator("objectives")
    @classmethod
    def dedupe_objectives(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(ProjectBase):
    pass


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
