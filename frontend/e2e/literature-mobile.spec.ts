import { expect, test, type Page } from "@playwright/test";

const LONG_DOI = "10.1016/j.neuroimage.2023." + "1234567890".repeat(12);
const paper = (over: Record<string, unknown>) => ({
  source: "openalex", external_id: "W1", doi: null, pmid: null, pmcid: null, publisher_url: null, title: "T", abstract: null, year: 2023, venue: null, authors: [],
  url: null, cited_by_count: null, keywords: [], extracted: {}, arxiv_id: null, sources: [{ provider: "openalex", external_id: "W1" }], preprint: false, links: [],
  primary_link: null, oa_url: null, publication_type: "journal_article", relevance: 0.5,
  match: { terms: 4, terms_found: 3, missing_terms: ["biomarker"], in_title: 2, exact_title: false, phrase_found: true },
  verification: { status: "single_source", sources_agreeing: 1, checks: [] }, ...over,
});
const STRESS = paper({
  external_id: "W2001", doi: LONG_DOI, pmid: "111", pmcid: "PMC999", arxiv_id: "2101.00001",
  title: "Interpretable multi-modal T1-weighted/T2-weighted/FLAIR/diffusion-tensor-imaging-based Alzheimer’s-disease-progression-biomarker-discovery-with-explainable-deep-learning-pipelines: a systematic evaluation on ADNI and AIBL",
  authors: Array.from({ length: 40 }, (_, i) => `Researcherwithaverylongsurname${i}-Hyphenated Ada${i}`),
  venue: "Proceedings of the International Conference on Medical Image Computing and Computer-Assisted Intervention Workshops",
  abstract: "Abstract-with-an-unbroken-token-" + "x".repeat(200) + " and some ordinary words after it.", cited_by_count: 1234567,
  publication_type: "conference_paper",
  sources: ["openalex", "pubmed", "europepmc", "crossref", "springer", "semanticscholar", "arxiv"].map((p) => ({ provider: p, external_id: p })),
  verification: { status: "conflict", sources_agreeing: 2, checks: [{ id: "identifier_conflict", status: "fail", detail: "Another record shares an identifier with this one but has a different PMID (111 vs 222), so they were not merged: " + "y".repeat(160) }] },
  primary_link: { kind: "pmc", label: "Read full text (PMC)", access: "full_text", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/" },
  links: [
    { kind: "pmc", label: "PMC full text", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/" },
    { kind: "fulltext", label: "Open-access full text", url: "https://example.org/" + "p".repeat(200) },
    { kind: "publisher", label: "Publisher page", url: "https://www.sciencedirect.com/science/article/pii/S1053811923000000" },
    { kind: "doi", label: "DOI", url: "https://doi.org/" + LONG_DOI },
    { kind: "pubmed", label: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/111/" },
    { kind: "arxiv", label: "arXiv", url: "https://arxiv.org/abs/2101.00001" },
    { kind: "europepmc", label: "Europe PMC", url: "https://europepmc.org/article/MED/111" },
    { kind: "openalex", label: "OpenAlex", url: "https://openalex.org/W2001" },
    { kind: "semanticscholar", label: "Semantic Scholar", url: "https://www.semanticscholar.org/paper/" + "a".repeat(40) },
  ],
});
const SHORT = paper({ external_id: "W2", title: "Short chapter", publication_type: "book_chapter", doi: "10.1007/978-3-031-16443-9_3", links: [{ kind: "doi", label: "DOI", url: "https://doi.org/10.1007/978-3-031-16443-9_3" }] });
const info = (id: string, name: string, group: string, extra = {}) => ({ id, name, group, requires_key: false, supports_key: false, key_configured: false, default_enabled: true, supports_full_text: false, rate_limit: "Fair use; a deliberately long rate limit description without any natural break points " + "z".repeat(80), docs: "", env_var: null, ...extra });
const PROVIDERS = [
  info("openalex", "OpenAlex", "general"), info("pubmed", "PubMed", "biomedical"), info("europepmc", "Europe PMC", "biomedical"), info("crossref", "Crossref", "general"),
  info("springer", "Springer Nature", "general", { requires_key: true, supports_key: true, env_var: "SPRINGER_API_KEY", default_enabled: false }),
  info("semanticscholar", "Semantic Scholar", "cs", { default_enabled: false, supports_key: true }), info("arxiv", "arXiv", "cs"),
];
const stat = (provider: string, name: string, extra = {}) => ({ provider, name, ok: true, count: 2, error: null, error_kind: null, duration_ms: 812, requests: 1, retries: 0, ...extra });

async function mockApi(page: Page) {
  const saved: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/health") return json({ status: "ok", database: "connected", email: "console", literature_keys: [] });
    if (p === "/api/auth/session") return json({ state: "user", user: { id: 1, full_name: "Ada Lovelace", email: "ada.with.a.very.long.address@example-university.edu", is_verified: true, created_at: "2026-01-01T00:00:00Z" }, trial: null, claimed_projects: 0, verification_required: false });
    if (p === "/api/projects") return json([{ id: 1, research_question: "Can T1-weighted MRI improve early Alzheimer’s detection using interpretable regional biomarkers?", modality: "T1-weighted MRI", disease: "Alzheimer's Disease", objectives: ["Early Detection"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]);
    if (p === "/api/papers/mine") return json(saved);
    if (p === "/api/literature/providers") return json(PROVIDERS);
    if (p === "/api/literature/search") {
      return json({ query: "q", source: "openalex", page: 1, results: [STRESS, SHORT], total_unique: 2, duration_ms: 1800, warnings: ["arXiv: arXiv is down"],
        providers: [stat("openalex", "OpenAlex"), stat("pubmed", "PubMed"), stat("crossref", "Crossref", { duration_ms: 9500, ok: false, count: 0, error: "The literature source did not answer within 10 s.", error_kind: "timeout", retries: 2, requests: 3 }), stat("arxiv", "arXiv", { ok: false, count: 0, error: "arXiv is down", error_kind: "error" })] });
    }
    if (p === "/api/literature/verify") return json({ source: "openalex", external_id: "W2001", status: "conflict", checks: [{ id: "pmcid_pmid", status: "fail", detail: "PMC maps PMC999 to PMID 7, not 111. " + "w".repeat(150) }] });
    if (p.endsWith("/papers") && route.request().method() === "POST") {
      const body = { ...SHORT, id: 9, project_ids: [1], cites: [] };
      saved.push(body);
      return json(body, 201);
    }
    return json({ detail: "unmocked " + p }, 404);
  });
}

for (const width of [320, 375, 390, 430]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    async function search(page: Page) {
      await mockApi(page);
      await page.goto("/literature");
      await page.getByLabel("Search publications").fill("interpretable multimodal biomarker discovery");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByText(/unique papers for/)).toBeVisible();
    }
    const overflow = (page: Page) => page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));

    test("screenshots (only when SHOTS_DIR is set)", async ({ page }) => {
      test.skip(!process.env.SHOTS_DIR, "set SHOTS_DIR to write screenshots");
      await search(page);
      const first = page.locator("main ul > li").filter({ has: page.locator("h3") }).first();
      await first.getByRole("button", { name: "Verify", exact: true }).click();
      await first.getByRole("button", { name: "Check identifiers online" }).click();
      await expect(first.getByText(/PMC maps PMC999/)).toBeVisible();
      await page.screenshot({ path: `${process.env.SHOTS_DIR}/mobile-${width}-results.png`, fullPage: true });
    });

    test("page never scrolls horizontally, before and after a search with worst-case data", async ({ page }) => {
      await mockApi(page);
      await page.goto("/literature");
      await expect(page.getByLabel("Search publications")).toBeVisible();
      let o = await overflow(page);
      expect(o.sw, "empty page").toBeLessThanOrEqual(o.vw);
      await search(page);
      o = await overflow(page);
      expect(o.sw, "with results").toBeLessThanOrEqual(o.vw);
    });

    test("every card, badge, link and status row fits inside the viewport", async ({ page }) => {
      await search(page);
      const outside = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("main *")].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && (b.right > vw + 1 || b.left < -1) && !el.closest("[aria-hidden='true']");
        }).map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 40)}`);
      });
      expect(outside).toEqual([]);
      for (const card of await page.locator("main ul > li").filter({ has: page.locator("h3") }).all()) {
        const box = (await card.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    });

    test("search input and button stay on one row and the project selector fits", async ({ page }) => {
      await mockApi(page);
      await page.goto("/literature");
      const input = (await page.getByLabel("Search publications").boundingBox())!;
      const btn = (await page.getByRole("button", { name: "Search", exact: true }).boundingBox())!;
      expect(Math.abs(btn.y + btn.height / 2 - (input.y + input.height / 2))).toBeLessThan(8);
      expect(btn.x).toBeGreaterThan(input.x + input.width - 1);
      expect(btn.x + btn.width).toBeLessThanOrEqual(width);
      const sel = (await page.locator("#lit-project").boundingBox())!;
      expect(sel.x + sel.width).toBeLessThanOrEqual(width);
      expect(input.height).toBeGreaterThanOrEqual(40); // comfortable tap target
    });

    test("source chips wrap inside the viewport and disabled sources say why", async ({ page }) => {
      await mockApi(page);
      await page.goto("/literature");
      await expect(page.getByLabel("PubMed")).toBeAttached();
      const chips = await page.locator("fieldset label").evaluateAll((ls) => ls.map((l) => { const b = l.getBoundingClientRect(); return b.right; }));
      expect(Math.max(...chips)).toBeLessThanOrEqual(width);
      await expect(page.getByText("(key needed)")).toBeVisible();
      await page.getByText("Source details and API keys").click();
      await expect(page.getByText(/not configured \(set SPRINGER_API_KEY on the server\)/)).toBeVisible();
      const o = await overflow(page);
      expect(o.sw).toBeLessThanOrEqual(o.vw);
    });

    test("provider status shows records, time, failure and retry info inside the viewport", async ({ page }) => {
      await search(page);
      const list = page.getByRole("list", { name: "Source status" });
      await expect(list).toContainText("OpenAlex: 2 records · 0.8 s");
      await expect(list).toContainText("Crossref: timed out · 9.5 s · retried 2×");
      await expect(page.getByRole("button", { name: "Retry Crossref" })).toBeVisible();
      const o = await overflow(page);
      expect(o.sw).toBeLessThanOrEqual(o.vw);
    });

    test("expanded verification panels and the abstract stay inside the viewport", async ({ page }) => {
      await search(page);
      const first = page.locator("main ul > li").filter({ has: page.locator("h3") }).first();
      await first.getByRole("button", { name: "Show full abstract" }).click();
      await first.getByRole("button", { name: "Verify", exact: true }).click();
      await first.getByRole("button", { name: "Check identifiers online" }).click();
      await expect(first.getByText(/PMC maps PMC999/)).toBeVisible();
      const o = await overflow(page);
      expect(o.sw).toBeLessThanOrEqual(o.vw);
    });

    test("nothing overlays the bottom actions: Load more is hit-testable at its centre", async ({ page }) => {
      await search(page);
      const more = page.getByRole("button", { name: "Load more" });
      await more.scrollIntoViewIfNeeded();
      const covered = await more.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !(top === el || el.contains(top));
      });
      expect(covered).toBe(false);
      const fixedBottom = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().bottom >= window.innerHeight - 1 && e.getBoundingClientRect().height > 0).length);
      expect(fixedBottom).toBe(0);
    });

    test("primary action, separate record links and Add to project work at this width", async ({ page }) => {
      await search(page);
      const first = page.locator("main ul > li").filter({ has: page.locator("h3") }).first();
      await expect(first.locator("a[data-primary]")).toHaveAttribute("href", "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/");
      const links = await first.getByRole("list", { name: "Links" }).getByRole("link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).textContent!.trim().split(" ")[0] + "|" + (a as HTMLAnchorElement).href));
      for (const k of ["PMC|", "Open-access|", "Publisher|", "DOI|https://doi.org/10.1016", "PubMed|https://pubmed.ncbi.nlm.nih.gov/111/", "arXiv|https://arxiv.org/abs/2101.00001", "Europe|https://europepmc.org/article/MED/111", "OpenAlex|", "Semantic|"]) {
        expect(links.some((l) => l.startsWith(k)), k).toBe(true);
      }
      await expect(first.getByText("Springer Nature", { exact: true })).toBeVisible();
      const second = page.locator("main ul > li").filter({ has: page.getByRole("heading", { name: "Short chapter" }) });
      await expect(second.getByText("Book chapter")).toBeVisible();
      const saveReq = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/projects/1/papers"));
      await second.getByRole("button", { name: "Add to project" }).click();
      expect(JSON.parse((await saveReq).postData()!)).toEqual({ source: "openalex", external_id: "W2" });
    });
  });
}
