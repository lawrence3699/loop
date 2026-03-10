import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "../../src/config/index.js";
import { discoverSkills } from "../../src/skills/loader.js";
import {
  initSharedPlan,
  updateSharedPlan,
  showPlan,
  clearPlan,
} from "../../src/plan/shared-plan.js";
import {
  addDecision,
  listDecisions,
  resolveDecision,
} from "../../src/plan/decisions.js";

describe("CLI Commands (integration)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-cli-integ-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Config loading ──────────────────────────────────
  describe("config loading", () => {
    it("defaults work correctly when no config files exist", async () => {
      const config = await loadConfig(tmpDir);

      expect(config.defaultExecutor).toBe(DEFAULT_CONFIG.defaultExecutor);
      expect(config.defaultReviewer).toBe(DEFAULT_CONFIG.defaultReviewer);
      expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
      expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
      expect(config.mode).toBe(DEFAULT_CONFIG.mode);
      expect(config.verbose).toBe(DEFAULT_CONFIG.verbose);
    });

    it("returns valid LoopConfig structure", async () => {
      const config = await loadConfig(tmpDir);

      expect(typeof config.defaultExecutor).toBe("string");
      expect(typeof config.defaultReviewer).toBe("string");
      expect(typeof config.maxIterations).toBe("number");
      expect(typeof config.threshold).toBe("number");
      expect(typeof config.mode).toBe("string");
      expect(typeof config.verbose).toBe("boolean");
      expect(["claude", "gemini", "codex"]).toContain(config.defaultExecutor);
      expect(["claude", "gemini", "codex"]).toContain(config.defaultReviewer);
      expect(config.maxIterations).toBeGreaterThanOrEqual(1);
      expect(config.maxIterations).toBeLessThanOrEqual(20);
      expect(config.threshold).toBeGreaterThanOrEqual(1);
      expect(config.threshold).toBeLessThanOrEqual(10);
    });
  });

  // ── Skill discovery ─────────────────────────────────
  describe("skill discovery", () => {
    it("finds built-in skills", async () => {
      const skills = await discoverSkills(tmpDir);

      // There should be at least the built-in skills (loop, plan, review)
      expect(skills.length).toBeGreaterThanOrEqual(3);

      const names = skills.map((s) => s.name);
      expect(names).toContain("loop");
      expect(names).toContain("plan");
      expect(names).toContain("review");
    });

    it("built-in skills have correct scope and content", async () => {
      const skills = await discoverSkills(tmpDir);

      for (const skill of skills) {
        if (skill.scope === "builtin") {
          expect(skill.name).toBeTruthy();
          expect(skill.content).toBeTruthy();
          expect(skill.path).toContain("skills");
          expect(skill.path).toContain("SKILL.md");
        }
      }
    });
  });

  // ── Shared plan init/update/show/clear cycle ────────
  describe("shared plan lifecycle", () => {
    it("init/update/show/clear cycle", async () => {
      const task = "Implement authentication module";

      // --- Init ---
      await initSharedPlan(tmpDir, task);
      const planPath = join(tmpDir, ".loop-plan.md");
      expect(existsSync(planPath)).toBe(true);

      // --- Show after init ---
      const initialContent = await showPlan(tmpDir);
      expect(initialContent).toContain("Loop Shared Plan");
      expect(initialContent).toContain(task);
      expect(initialContent).toContain("No iterations yet");

      // --- Update with iteration 1 ---
      await updateSharedPlan(
        tmpDir,
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          executor: "claude",
          reviewer: "gemini",
          executorSummary: "Created auth middleware and login route",
          score: 6,
          approved: false,
          reviewerFeedback: "Missing input validation",
        },
        ["auth.ts", "routes/login.ts"],
      );

      const afterUpdate1 = await showPlan(tmpDir);
      expect(afterUpdate1).toContain("Iteration 1");
      expect(afterUpdate1).toContain("claude");
      expect(afterUpdate1).toContain("gemini");
      expect(afterUpdate1).toContain("6/10");
      expect(afterUpdate1).toContain("No");
      expect(afterUpdate1).toContain("auth.ts");
      expect(afterUpdate1).toContain("routes/login.ts");

      // --- Update with iteration 2 ---
      await updateSharedPlan(
        tmpDir,
        {
          iteration: 2,
          timestamp: new Date().toISOString(),
          executor: "claude",
          reviewer: "gemini",
          executorSummary: "Added input validation",
          score: 9,
          approved: true,
          reviewerFeedback: "Great improvement!",
        },
        ["auth.ts"],
      );

      const afterUpdate2 = await showPlan(tmpDir);
      expect(afterUpdate2).toContain("Iteration 2");
      expect(afterUpdate2).toContain("9/10");
      expect(afterUpdate2).toContain("Yes");

      // --- Clear ---
      await clearPlan(tmpDir);
      expect(existsSync(planPath)).toBe(false);

      // --- Show after clear ---
      const afterClear = await showPlan(tmpDir);
      expect(afterClear).toContain("No plan file found");
    });
  });

  // ── Decision add/list/resolve cycle ─────────────────
  describe("decision lifecycle", () => {
    it("add/list/resolve cycle", async () => {
      // --- Add decision 1 ---
      const d1 = await addDecision(tmpDir, {
        title: "Use PostgreSQL for persistence",
        status: "proposed",
        context: "Need a reliable database",
        decision: "We will use PostgreSQL",
        consequences: "Need to set up migration tooling",
      });

      expect(d1.id).toBe(1);
      expect(d1.title).toBe("Use PostgreSQL for persistence");
      expect(d1.status).toBe("proposed");

      // --- Add decision 2 ---
      const d2 = await addDecision(tmpDir, {
        title: "Use REST over GraphQL",
        status: "proposed",
        context: "Simpler to implement",
        decision: "We will use REST APIs",
        consequences: "Less flexibility for frontend queries",
      });

      expect(d2.id).toBe(2);

      // --- List decisions ---
      const decisions = await listDecisions(tmpDir);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].title).toBe("Use PostgreSQL for persistence");
      expect(decisions[1].title).toBe("Use REST over GraphQL");

      // --- Resolve decision 1 ---
      await resolveDecision(tmpDir, 1, "accepted");

      const afterResolve = await listDecisions(tmpDir);
      const resolved = afterResolve.find((d) => d.id === 1);
      expect(resolved).toBeDefined();
      expect(resolved!.status).toBe("accepted");

      // Decision 2 should remain proposed
      const unresolved = afterResolve.find((d) => d.id === 2);
      expect(unresolved).toBeDefined();
      expect(unresolved!.status).toBe("proposed");
    });

    it("resolveDecision throws for non-existent ID", async () => {
      await expect(resolveDecision(tmpDir, 999, "accepted")).rejects.toThrow();
    });
  });
});
