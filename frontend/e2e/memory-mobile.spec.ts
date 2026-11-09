import { expect, test, type Page } from "@playwright/test";

const LONG = "Unbroken-token-" + "x".repeat(180);
const paperRef = { id: 5, title: "Interpretable multi-modal T1-weighted/T2-weighted/FLAIR/diffusion-tensor-imaging Alzheimer’s-disease-progression-biomarker-discovery " + LONG, doi: "10.1016/j.neuroimage.2023." + "1234567890".repeat(10), pmid: "111", pmcid: null, source: "openalex", year: 2023, in_project: true, url: null };
const entry = (id: number, over: Record<string, unknown> = {}) => ({
  id, paper_id: 5, memory_type: "literature", field: "metric", title: "t", content: "accuracy 92.3% " + LONG, origin: "auto", source_type: "rule_extracted",
  source_reference: "abstract of doi:10.1016/j.neuroimage.2023." + "1234567890".repeat(10), extraction_method: "rule-based regular expressions on abstract/title (explicit numbers only)",
  matched_text: "The model reached an accuracy of 92.3% in 10-fold cross-validation. " + LONG, section_name: "abstract", page_number: null, extracted_at: "2026-11-09T10:00:00Z",
  verification_status: "unverified", confidence: null, reviewed_at: null, created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z", paper: paperRef, ...over,
});
const page = (items: unknown[]) => ({ total: items.length, limit: 100, offset: 0, items });
const ev = (id: number, rel: string, kind: string, ver: string) => ({ id, claim_id: 2, paper_id: 5, relationship: rel, evidence_kind: kind, quoted_text: "Quoted passage " + LONG, section_name: "abstract", page_number: 4, source_url: null, verification_status: ver, created_at: "x", paper: paperRef });
const OVERVIEW = {
  project_id: 1, research_question: "Can T1-weighted MRI improve early Alzheimer’s detection using interpretable regional biomarkers?", disease: "Alzheimer's Disease", modality: "T1-weighted MRI",
  objectives: ["Early Detection"], version: 2, summary: "2 saved paper(s); 9 memory entries (6 rule-extracted). " + LONG, last_rebuilt_at: "2026-11-09T10:00:00Z", last_updated_at: "2026-11-09T10:05:00Z",
  counts: { entries: 9, confirmed: 1, unverified: 6, rejected: 0, claims: 1, evidence: 2, decisions: 1, gaps: 1, saved_papers: 2, by_source: { source_metadata: 2, rule_extracted: 6, ai_extracted: 0, researcher_confirmed: 1, researcher_entered: 0 } },
  conflicts: [{ kind: "metric_variation", metric: "accuracy", note: "Different datasets are not directly comparable. " + LONG, values: [{ paper: paperRef.title, value: "accuracy 92.3%", source_sentence: "s", datasets_named_in_paper: ["ADNI", "AIBL"] }, { paper: "Other", value: "accuracy 71%", source_sentence: "s", datasets_named_in_paper: [] }] }],
  not_extracted: ["research_objective", "study_population", "preprocessing", "feature_extraction", "training_strategy", "validation_strategy", "main_findings", "limitations", "future_research"],
  notice: "Entries marked rule_extracted are keyword/regex matches on titles and abstracts, not verified findings.",
};

async function mockApi(p: Page) {
  await p.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const path = url.pathname;
    if (path === "/api/health") return json({ status: "ok", database: "connected", email: "console", literature_keys: [] });
    if (path === "/api/auth/session") return json({ state: "user", user: { id: 1, full_name: "Ada Lovelace", email: "ada@example.com", is_verified: true, created_at: "2026-01-01T00:00:00Z" }, trial: null, claimed_projects: 0, verification_required: false });
    if (path === "/api/projects") return json([{ id: 1, research_question: OVERVIEW.research_question, modality: "T1-weighted MRI", disease: "Alzheimer's Disease", objectives: ["Early Detection"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]);
    if (path === "/api/projects/1/papers") return json([{ id: 5, title: paperRef.title }]);
    if (path === "/api/projects/1/memory") return json(OVERVIEW);
    if (path === "/api/projects/1/memory/entries") return json(page([entry(1), entry(2, { field: "dataset", content: "ADNI", source_type: "source_metadata", verification_status: "source_reported" }), entry(3, { verification_status: "rejected" })]));
    if (path === "/api/projects/1/memory/claims") return json(page([{ id: 2, claim_text: "Claim text " + LONG, claim_type: "finding", origin: "researcher", status: "active", confidence: null, created_at: "x", updated_at: "x", contested: true, evidence: [ev(1, "supports", "quote", "source_matched"), ev(2, "contradicts", "paraphrase", "unverified")] }]));
    if (path === "/api/projects/1/memory/gaps") return json(page([{ id: 1, title: "Gap " + LONG, description: "Description " + LONG, gap_category: "evaluation", evidence_summary: "Evidence " + LONG, researcher_comment: null, status: "potential", confidence: null, created_at: "x", updated_at: "x", notice: "n" }]));
    if (path === "/api/projects/1/memory/decisions") return json(page([{ id: 1, supersedes_id: null, decision_type: "method_selected", description: "Decision " + LONG, rationale: "Because " + LONG, status: "active", created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" }]));
    if (path === "/api/projects/1/memory/audit") return json(page([{ id: 1, event_type: "rebuilt", actor: "system", subject_type: "memory", subject_id: 1, detail: { created: 9, note: LONG }, created_at: "2026-11-09T10:00:00Z" }]));
    return json({ detail: "unmocked " + path }, 404);
  });
}

const TABS = ["Overview", "Research identity", "Literature insights", "Evidence", "Decisions", "Research gaps", "Experiment context", "Memory history"];
for (const width of [320, 375, 390, 430]) {
  test.describe(`memory panel at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    test("no horizontal page scroll in any section, controls reach tap size", async ({ page }) => {
      await mockApi(page);
      await page.goto("/workspace");
      await expect(page.getByRole("heading", { name: /What this project knows/ })).toBeVisible();
      await expect(page.getByText("Memory entries", { exact: true })).toBeVisible(); // let the overview finish loading so nothing shifts under the click
      await page.waitForTimeout(800);
      for (const name of TABS) {
        const tab = page.getByRole("tab", { name });
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
        expect(m.sw, `${name}: page scrollWidth ${m.sw} > viewport ${m.vw}`).toBeLessThanOrEqual(m.vw);
        const wide = await page.evaluate(() => {
          const panel = document.getElementById("memory-tabpanel");
          if (!panel) return ["no panel"];
          const box = panel.getBoundingClientRect();
          return [...panel.querySelectorAll<HTMLElement>("*")].filter((el) => el.getBoundingClientRect().right > box.right + 1).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`).slice(0, 5);
        });
        expect(wide, `${name}: elements wider than the panel`).toEqual([]);
        if (process.env.SHOTS_DIR) await page.getByRole("tabpanel").screenshot({ path: `${process.env.SHOTS_DIR}/memory-${width}-${name.replace(/\W+/g, "-").toLowerCase()}.png` });
      }
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#memory-tabpanel button, [role=tab]")].filter((b) => b.getBoundingClientRect().height < 40).map((b) => b.textContent));
      expect(small, "buttons under 40px tall").toEqual([]);
    });
  });
}
