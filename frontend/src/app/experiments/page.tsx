import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/ComingSoon";
import { MODULES } from "@/lib/modules";

export const metadata: Metadata = { title: "Experiments — ResearchForge" };

export default function ExperimentsPage() {
  return (
    <ComingSoon
      module={MODULES.find((m) => m.id === "experiments")!}
      title="Experiment engine"
      intro="Configure, run and compare experiments on real datasets, with validation designed to avoid data leakage."
      planned={[
        { title: "Subject-wise splitting", desc: "Participant-aware train/validation/test splits and stratified cross-validation." },
        { title: "Classical ML and deep models", desc: "Baselines plus CNN, GCN, GAT, GraphSAGE and GIN, with reproducible seeds." },
        { title: "Evaluation and interpretability", desc: "Balanced accuracy, ROC-AUC, confidence intervals, SHAP and ROI importance." },
      ]}
    />
  );
}
