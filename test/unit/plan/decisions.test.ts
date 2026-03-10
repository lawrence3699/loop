import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addDecision,
  listDecisions,
  resolveDecision,
} from "../../../src/plan/decisions.js";

describe("decisions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-decisions-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── addDecision ────────────────────────────────────
  describe("addDecision", () => {
    it("creates a numbered markdown file", async () => {
      const decision = await addDecision(tmpDir, {
        title: "Use TypeScript",
        status: "proposed",
        context: "We need type safety",
        decision: "Adopt TypeScript for all new code",
        consequences: "Must set up tsconfig",
      });

      expect(decision.id).toBe(1);
      expect(decision.title).toBe("Use TypeScript");
      expect(decision.status).toBe("proposed");
      expect(decision.date).toBeTruthy();

      // Check file was created
      const dir = join(tmpDir, ".loop", "context", "decisions");
      expect(existsSync(dir)).toBe(true);
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^0001-use-typescript\.md$/);
    });

    it("increments ID for subsequent decisions", async () => {
      const d1 = await addDecision(tmpDir, {
        title: "First",
        status: "proposed",
        context: "ctx",
        decision: "dec",
        consequences: "con",
      });

      const d2 = await addDecision(tmpDir, {
        title: "Second",
        status: "accepted",
        context: "ctx",
        decision: "dec",
        consequences: "con",
      });

      expect(d1.id).toBe(1);
      expect(d2.id).toBe(2);
    });

    it("slugifies the title for the filename", async () => {
      await addDecision(tmpDir, {
        title: "Use Spaces And CAPS!?",
        status: "proposed",
        context: "",
        decision: "",
        consequences: "",
      });

      const dir = join(tmpDir, ".loop", "context", "decisions");
      const files = readdirSync(dir);
      expect(files[0]).toMatch(/^0001-use-spaces-and-caps\.md$/);
    });

    it("creates the decisions directory if missing", async () => {
      const dir = join(tmpDir, ".loop", "context", "decisions");
      expect(existsSync(dir)).toBe(false);

      await addDecision(tmpDir, {
        title: "Test",
        status: "proposed",
        context: "",
        decision: "",
        consequences: "",
      });

      expect(existsSync(dir)).toBe(true);
    });
  });

  // ── listDecisions ──────────────────────────────────
  describe("listDecisions", () => {
    it("returns empty array when no decisions exist", async () => {
      const decisions = await listDecisions(tmpDir);
      expect(decisions).toEqual([]);
    });

    it("returns all decisions sorted by ID", async () => {
      await addDecision(tmpDir, {
        title: "First",
        status: "proposed",
        context: "ctx1",
        decision: "dec1",
        consequences: "con1",
      });

      await addDecision(tmpDir, {
        title: "Second",
        status: "accepted",
        context: "ctx2",
        decision: "dec2",
        consequences: "con2",
      });

      const decisions = await listDecisions(tmpDir);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].id).toBe(1);
      expect(decisions[0].title).toBe("First");
      expect(decisions[1].id).toBe(2);
      expect(decisions[1].title).toBe("Second");
    });

    it("parses decision content correctly", async () => {
      await addDecision(tmpDir, {
        title: "Test Decision",
        status: "accepted",
        context: "We need this for testing",
        decision: "Use vitest for all tests",
        consequences: "Must install vitest as devDep",
      });

      const decisions = await listDecisions(tmpDir);
      expect(decisions[0].status).toBe("accepted");
      expect(decisions[0].context).toBe("We need this for testing");
      expect(decisions[0].decision).toBe("Use vitest for all tests");
      expect(decisions[0].consequences).toBe("Must install vitest as devDep");
    });
  });

  // ── resolveDecision ────────────────────────────────
  describe("resolveDecision", () => {
    it("updates the status of a decision", async () => {
      await addDecision(tmpDir, {
        title: "To Be Resolved",
        status: "proposed",
        context: "",
        decision: "",
        consequences: "",
      });

      await resolveDecision(tmpDir, 1, "accepted");

      const decisions = await listDecisions(tmpDir);
      expect(decisions[0].status).toBe("accepted");
    });

    it("supports all valid statuses", async () => {
      await addDecision(tmpDir, {
        title: "Lifecycle",
        status: "proposed",
        context: "",
        decision: "",
        consequences: "",
      });

      await resolveDecision(tmpDir, 1, "rejected");
      let decisions = await listDecisions(tmpDir);
      expect(decisions[0].status).toBe("rejected");

      await resolveDecision(tmpDir, 1, "superseded");
      decisions = await listDecisions(tmpDir);
      expect(decisions[0].status).toBe("superseded");
    });

    it("throws when decision not found", async () => {
      // Create decisions dir but no decision with ID 99
      await addDecision(tmpDir, {
        title: "Placeholder",
        status: "proposed",
        context: "",
        decision: "",
        consequences: "",
      });

      await expect(resolveDecision(tmpDir, 99, "accepted")).rejects.toThrow(
        "Decision 99 not found",
      );
    });

    it("throws when decisions directory not found", async () => {
      await expect(resolveDecision(tmpDir, 1, "accepted")).rejects.toThrow(
        "Decisions directory not found",
      );
    });
  });
});
