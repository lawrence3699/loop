import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initSharedPlan,
  updateSharedPlan,
  getExecutorContext,
  getReviewerContext,
  clearPlan,
  showPlan,
  type IterationRecord,
} from "../../../src/plan/shared-plan.js";

describe("shared-plan", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-plan-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── initSharedPlan ─────────────────────────────────
  describe("initSharedPlan", () => {
    it("creates .loop-plan.md file", async () => {
      await initSharedPlan(tmpDir, "Build a CLI tool");
      expect(existsSync(join(tmpDir, ".loop-plan.md"))).toBe(true);
    });

    it("includes the task in the plan file", async () => {
      await initSharedPlan(tmpDir, "Build a CLI tool");
      const content = readFileSync(join(tmpDir, ".loop-plan.md"), "utf-8");
      expect(content).toContain("Build a CLI tool");
      expect(content).toContain("# Loop Shared Plan");
      expect(content).toContain("## Task");
    });

    it("initializes with empty iteration history", async () => {
      await initSharedPlan(tmpDir, "task");
      const content = readFileSync(join(tmpDir, ".loop-plan.md"), "utf-8");
      expect(content).toContain("_No iterations yet._");
    });
  });

  // ── updateSharedPlan ───────────────────────────────
  describe("updateSharedPlan", () => {
    it("appends iteration record to plan", async () => {
      await initSharedPlan(tmpDir, "test task");

      const record: IterationRecord = {
        iteration: 1,
        executor: "claude",
        reviewer: "gemini",
        score: 7,
        approved: false,
        executorSummary: "Implemented basic structure",
        reviewerFeedback: "Missing error handling",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await updateSharedPlan(tmpDir, record, ["src/app.ts"]);

      const content = readFileSync(join(tmpDir, ".loop-plan.md"), "utf-8");
      expect(content).toContain("### Iteration 1");
      expect(content).toContain("**Score:** 7/10");
      expect(content).toContain("**Approved:** No");
      expect(content).toContain("Implemented basic structure");
      expect(content).toContain("Missing error handling");
      expect(content).toContain("src/app.ts");
    });

    it("creates plan if it does not exist yet", async () => {
      const record: IterationRecord = {
        iteration: 1,
        executor: "claude",
        reviewer: "gemini",
        score: 9,
        approved: true,
        executorSummary: "All done",
        reviewerFeedback: "Looks great",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await updateSharedPlan(tmpDir, record, []);

      const content = readFileSync(join(tmpDir, ".loop-plan.md"), "utf-8");
      expect(content).toContain("### Iteration 1");
    });

    it("appends multiple iteration records", async () => {
      await initSharedPlan(tmpDir, "test");

      for (let i = 1; i <= 3; i++) {
        await updateSharedPlan(
          tmpDir,
          {
            iteration: i,
            executor: "claude",
            reviewer: "gemini",
            score: i + 5,
            approved: i === 3,
            executorSummary: `Summary ${i}`,
            reviewerFeedback: `Feedback ${i}`,
            timestamp: `2025-01-0${i}T00:00:00Z`,
          },
          [`file${i}.ts`],
        );
      }

      const content = readFileSync(join(tmpDir, ".loop-plan.md"), "utf-8");
      expect(content).toContain("### Iteration 1");
      expect(content).toContain("### Iteration 2");
      expect(content).toContain("### Iteration 3");
      expect(content).toContain("file1.ts");
      expect(content).toContain("file2.ts");
      expect(content).toContain("file3.ts");
    });
  });

  // ── getExecutorContext ─────────────────────────────
  describe("getExecutorContext", () => {
    it("returns empty string when no plan exists", async () => {
      const ctx = await getExecutorContext(tmpDir);
      expect(ctx).toBe("");
    });

    it("returns empty string when plan has no iterations", async () => {
      await initSharedPlan(tmpDir, "task");
      const ctx = await getExecutorContext(tmpDir);
      expect(ctx).toBe("");
    });

    it("returns last iteration feedback", async () => {
      await initSharedPlan(tmpDir, "task");
      await updateSharedPlan(
        tmpDir,
        {
          iteration: 1,
          executor: "claude",
          reviewer: "gemini",
          score: 6,
          approved: false,
          executorSummary: "Initial attempt",
          reviewerFeedback: "Fix the bug in parser",
          timestamp: "2025-01-01T00:00:00Z",
        },
        ["parser.ts"],
      );

      const ctx = await getExecutorContext(tmpDir);
      expect(ctx).toContain("Last iteration: 1");
      expect(ctx).toContain("Reviewer score: 6/10");
      expect(ctx).toContain("Approved: No");
      expect(ctx).toContain("Fix the bug in parser");
      expect(ctx).toContain("parser.ts");
    });
  });

  // ── getReviewerContext ─────────────────────────────
  describe("getReviewerContext", () => {
    it("returns empty string when no plan exists", async () => {
      const ctx = await getReviewerContext(tmpDir);
      expect(ctx).toBe("");
    });

    it("returns iteration history summary", async () => {
      await initSharedPlan(tmpDir, "task");
      await updateSharedPlan(
        tmpDir,
        {
          iteration: 1,
          executor: "claude",
          reviewer: "gemini",
          score: 7,
          approved: false,
          executorSummary: "First try",
          reviewerFeedback: "Needs improvements\nMore details here",
          timestamp: "2025-01-01T00:00:00Z",
        },
        [],
      );

      const ctx = await getReviewerContext(tmpDir);
      expect(ctx).toContain("## Iteration History");
      expect(ctx).toContain("Score 7/10");
      expect(ctx).toContain("Not approved");
      expect(ctx).toContain("Needs improvements");
    });
  });

  // ── clearPlan ──────────────────────────────────────
  describe("clearPlan", () => {
    it("removes the plan file", async () => {
      await initSharedPlan(tmpDir, "task");
      expect(existsSync(join(tmpDir, ".loop-plan.md"))).toBe(true);

      await clearPlan(tmpDir);
      expect(existsSync(join(tmpDir, ".loop-plan.md"))).toBe(false);
    });

    it("does not throw when no plan file exists", async () => {
      await expect(clearPlan(tmpDir)).resolves.not.toThrow();
    });
  });

  // ── showPlan ───────────────────────────────────────
  describe("showPlan", () => {
    it("returns plan content when file exists", async () => {
      await initSharedPlan(tmpDir, "show me");
      const content = await showPlan(tmpDir);
      expect(content).toContain("show me");
    });

    it("returns 'No plan file found' when file does not exist", async () => {
      const content = await showPlan(tmpDir);
      expect(content).toBe("No plan file found.");
    });
  });
});
