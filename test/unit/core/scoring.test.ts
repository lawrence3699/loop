import { describe, it, expect } from "vitest";
import {
  evaluateReview,
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from "../../../src/core/scoring.js";

describe("evaluateReview", () => {
  const defaultConfig: ScoringConfig = { ...DEFAULT_SCORING_CONFIG };

  const makeReview = (
    score: number,
    approved: boolean,
    issues: string[] = [],
    suggestions: string[] = [],
  ) => ({ score, approved, issues, suggestions });

  // ── undefined review ───────────────────────────────
  it("returns not-approved with reason when review is undefined", () => {
    const result = evaluateReview(undefined, defaultConfig);
    expect(result.approved).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("No review data");
  });

  // ── standard mode: threshold-based ─────────────────
  it("approves when score >= threshold", () => {
    const result = evaluateReview(makeReview(9, false), defaultConfig);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain("meets threshold");
  });

  it("rejects when score < threshold", () => {
    const result = evaluateReview(makeReview(7, false), defaultConfig);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Not approved");
  });

  it("approves on explicit APPROVED regardless of score", () => {
    const result = evaluateReview(makeReview(3, true), defaultConfig);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain("explicitly approved");
  });

  it("shows both reasons when score meets threshold AND explicitly approved", () => {
    const result = evaluateReview(makeReview(10, true), defaultConfig);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain("score: 10/10");
    expect(result.reason).toContain("explicitly approved");
  });

  // ── requireExplicitApproval mode ───────────────────
  it("rejects when requireExplicitApproval is true and not explicitly approved even if score >= threshold", () => {
    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: true };
    const result = evaluateReview(makeReview(10, false), config);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("did not explicitly approve");
  });

  it("approves when requireExplicitApproval and reviewer explicitly approved", () => {
    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: true };
    const result = evaluateReview(makeReview(5, true), config);
    expect(result.approved).toBe(true);
    expect(result.reason).toContain("Reviewer explicitly approved");
  });

  // ── edge cases ─────────────────────────────────────
  it("handles score exactly at threshold", () => {
    const result = evaluateReview(makeReview(9, false), { threshold: 9, requireExplicitApproval: false });
    expect(result.approved).toBe(true);
  });

  it("rejects score one below threshold", () => {
    const result = evaluateReview(makeReview(8, false), { threshold: 9, requireExplicitApproval: false });
    expect(result.approved).toBe(false);
  });

  it("handles score of 1", () => {
    const result = evaluateReview(makeReview(1, false), defaultConfig);
    expect(result.approved).toBe(false);
    expect(result.score).toBe(1);
  });

  it("handles score of 10", () => {
    const result = evaluateReview(makeReview(10, false), defaultConfig);
    expect(result.approved).toBe(true);
    expect(result.score).toBe(10);
  });

  it("includes issue count in rejection reason", () => {
    const result = evaluateReview(
      makeReview(5, false, ["issue1", "issue2"]),
      defaultConfig,
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("2 issues");
  });

  it("uses singular 'issue' for single issue", () => {
    const result = evaluateReview(
      makeReview(5, false, ["only-one"]),
      defaultConfig,
    );
    expect(result.reason).toContain("1 issue");
    expect(result.reason).not.toContain("1 issues");
  });

  it("does not mention issues when there are none", () => {
    const result = evaluateReview(makeReview(5, false, []), defaultConfig);
    expect(result.reason).not.toContain("issue");
  });

  // ── default config constant ────────────────────────
  it("DEFAULT_SCORING_CONFIG has expected values", () => {
    expect(DEFAULT_SCORING_CONFIG.threshold).toBe(9);
    expect(DEFAULT_SCORING_CONFIG.requireExplicitApproval).toBe(false);
  });
});
