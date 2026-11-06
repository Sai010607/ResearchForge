"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { TrialBadge } from "@/components/auth/TrialBadge";
import { TrialGate } from "@/components/auth/TrialGate";
import { UpgradePrompt } from "@/components/auth/UpgradePrompt";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { ApiError, api } from "@/lib/api";
import { EXAMPLE_QUESTION, suggestFromQuestion } from "@/lib/suggest";
import { cn } from "@/lib/utils";
import { DISEASES, MODALITIES, OBJECTIVES, type Disease, type Modality, type Objective, type Project } from "@/types/project";

const MAX = 2000;
const MIN = 10;

/**
 * Next 16 (cacheComponents) keeps previously visited routes mounted but hidden, so this form's
 * state would survive a login/logout done on another page (e.g. a stale "trial ready" panel for
 * someone who has since registered). Keying by identity gives every identity a fresh form.
 */
export function ProjectForm() {
  const { status, user } = useAuth();
  return <ProjectFormInner key={status === "user" ? `u${user?.id}` : status} />;
}

function ProjectFormInner() {
  const id = useId();
  const { addProject } = useProjects();
  const { status: authStatus, trial, reload } = useAuth();
  const [createdAsGuest, setCreatedAsGuest] = useState(false);

  const [question, setQuestion] = useState("");
  const [modality, setModality] = useState<Modality>("T1-weighted MRI");
  const [disease, setDisease] = useState<Disease>("Alzheimer's Disease");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const [created, setCreated] = useState<Project | null>(null);
  const [dismissed, setDismissed] = useState("");

  const trimmed = question.trim();
  const errors = {
    question: trimmed.length < MIN ? `Describe your research question in at least ${MIN} characters.` : "",
    objectives: objectives.length === 0 ? "Select at least one research objective." : "",
  };
  const showErrors = touched;

  const suggestion = useMemo(() => {
    const s = suggestFromQuestion(question);
    const changes: string[] = [];
    if (s.modality && s.modality !== modality) changes.push(s.modality);
    if (s.disease && s.disease !== disease) changes.push(s.disease);
    return { ...s, label: changes.join(" · ") };
  }, [question, modality, disease]);

  const toggle = (o: Objective) =>
    setObjectives((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError("");
    if (errors.question || errors.objectives) return;
    setLoading(true);
    try {
      const p = await api.createProject({ research_question: trimmed, modality, disease, objectives });
      addProject(p);
      setCreatedAsGuest(authStatus === "guest");
      setCreated(p);
      if (authStatus === "guest") void reload(); // trial is now consumed server-side; refresh the badge
    } catch (err) {
      if (err instanceof ApiError && (err.code === "trial_exhausted" || err.code === "not_authenticated")) {
        void reload(); // another tab used the trial / session changed: show the real state
      }
      setServerError(err instanceof ApiError ? err.message : "Unexpected error while creating the project.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCreated(null);
    setCreatedAsGuest(false);
    setQuestion("");
    setObjectives([]);
    setTouched(false);
    setDismissed("");
  }

  if (!created) {
    if (authStatus === "loading")
      return <div className="h-96 animate-pulse rounded-2xl bg-white/[0.03]" aria-busy="true" aria-label="Loading" />;
    if (authStatus === "anonymous") return <TrialGate />;
    if (authStatus === "guest" && trial?.exhausted) return <UpgradePrompt variant="exhausted" />;
  }

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-6 sm:p-8">
      {authStatus === "guest" && !created && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <TrialBadge />
          <span className="text-xs text-muted">Your free trial includes one saved research project.</span>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {created ? (
          <motion.div
            key="done"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="py-4"
          >
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan"
            >
              <Check size={20} />
            </motion.span>
            <h2 className="mt-5 text-xl font-semibold">Project #{created.id} saved to your database</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">{created.research_question}</p>
            <p className="mt-3 font-mono text-xs text-muted">
              {created.modality} · {created.disease} · {created.objectives.join(", ")}
            </p>
            {createdAsGuest ? (
              <div className="mt-7">
                <UpgradePrompt variant="ready" />
              </div>
            ) : (
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/dashboard" className="rounded-lg bg-gradient-to-r from-azure to-[#3b82ff] px-5 py-2.5 text-sm font-medium">
                View on dashboard
              </Link>
              <Link href="/knowledge-graph" className="rounded-lg border border-line-strong px-5 py-2.5 text-sm hover:bg-white/[0.04]">
                Explore as graph
              </Link>
              <button type="button" onClick={reset} className="rounded-lg px-5 py-2.5 text-sm text-muted hover:text-white">
                Create another
              </button>
            </div>
            )}
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={submit}
            noValidate
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-7"
          >
            <div>
              <div className="mb-2 flex items-end justify-between">
                <label htmlFor={`${id}-q`} className="text-xs font-medium uppercase tracking-wider text-muted">
                  Research question
                </label>
                {!question && (
                  <button type="button" onClick={() => setQuestion(EXAMPLE_QUESTION)} className="text-xs text-cyan hover:underline">
                    Use an example
                  </button>
                )}
              </div>
              {/* gradient border appears while the field has focus */}
              <div
                className={cn(
                  "rounded-xl bg-line-strong p-px transition-all duration-300 focus-within:bg-gradient-to-r focus-within:from-azure focus-within:via-cyan focus-within:to-ice focus-within:shadow-[0_0_40px_-12px_rgba(0,207,255,0.5)]",
                  showErrors && errors.question && "bg-red-500/60",
                )}
              >
                <textarea
                  id={`${id}-q`}
                  value={question}
                  maxLength={MAX}
                  rows={4}
                  onChange={(e) => setQuestion(e.target.value)}
                  aria-invalid={showErrors && !!errors.question}
                  aria-describedby={`${id}-q-help`}
                  placeholder="e.g. Can T1-weighted MRI improve early Alzheimer's detection using interpretable regional biomarkers?"
                  className="block w-full resize-none rounded-[11px] bg-ink-900 p-4 text-[15px] leading-relaxed outline-none placeholder:text-slate-600"
                />
              </div>
              <div id={`${id}-q-help`} className="mt-2 flex justify-between text-xs">
                <span className={showErrors && errors.question ? "text-red-300" : "text-muted"}>
                  {showErrors && errors.question ? errors.question : "State what you want to learn, with what data, and why."}
                </span>
                <span className="font-mono text-muted">
                  {question.length}/{MAX}
                </span>
              </div>

              <AnimatePresence>
                {suggestion.label && dismissed !== suggestion.label && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-2 text-xs">
                      <Sparkles size={14} className="text-cyan" />
                      <span className="text-slate-300">
                        Your question mentions <strong className="font-medium text-white">{suggestion.label}</strong>
                      </span>
                      <button
                        type="button"
                        className="rounded border border-cyan/40 px-2 py-0.5 text-cyan hover:bg-cyan/10"
                        onClick={() => {
                          if (suggestion.modality) setModality(suggestion.modality);
                          if (suggestion.disease) setDisease(suggestion.disease);
                        }}
                      >
                        Apply
                      </button>
                      <button type="button" className="text-muted hover:text-white" onClick={() => setDismissed(suggestion.label)}>
                        Dismiss
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Select label="Imaging modality" value={modality} options={MODALITIES} onChange={setModality} />
              <Select label="Research domain" value={disease} options={DISEASES} onChange={setDisease} />
            </div>

            <fieldset aria-describedby={`${id}-obj-help`}>
              <legend className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Research objectives</legend>
              <div className="flex flex-wrap gap-2">
                {OBJECTIVES.map((o) => {
                  const on = objectives.includes(o);
                  return (
                    <motion.button
                      key={o}
                      type="button"
                      aria-pressed={on}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => toggle(o)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors",
                        on
                          ? "border-cyan/60 bg-cyan/10 text-cyan"
                          : "border-line-strong text-slate-300 hover:border-slate-500",
                      )}
                    >
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.span
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 14, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <Check size={14} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {o}
                    </motion.button>
                  );
                })}
              </div>
              <p id={`${id}-obj-help`} className={cn("mt-2 text-xs", showErrors && errors.objectives ? "text-red-300" : "text-muted")}>
                {showErrors && errors.objectives ? errors.objectives : "Choose one or more."}
              </p>
            </fieldset>

            {serverError && (
              <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {serverError}
              </div>
            )}

            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.985 }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-azure to-[#3b82ff] px-6 py-3.5 text-sm font-medium shadow-[0_8px_30px_-10px_rgba(37,99,255,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" /> Saving to database…
                </>
              ) : (
                "Create research project"
              )}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
