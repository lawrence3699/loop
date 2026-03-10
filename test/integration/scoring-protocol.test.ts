import { describe, it, expect } from "vitest";
import {
  createExecutorMessage,
  parseReviewerOutput,
  formatForReviewer,
  serializeMessage,
  deserializeMessage,
  type LoopMessage,
} from "../../src/core/protocol.js";
import { evaluateReview, type ScoringConfig } from "../../src/core/scoring.js";

describe("Scoring + Protocol (integration)", () => {
  const task = "Create a REST API with user authentication";

  it("full scoring-protocol pipeline: executor message -> reviewer parse -> evaluate", () => {
    // --- Create an executor message with known output ---
    const executorMsg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: task,
      context: "",
      outputText: "I created auth.ts, modified server.ts, and wrote to routes.ts\n$ npm install express",
      durationMs: 5000,
      bytesReceived: 1024,
    });

    // Verify executor message structure
    expect(executorMsg.protocol).toBe("loop-v1");
    expect(executorMsg.role).toBe("executor");
    expect(executorMsg.engine).toBe("claude");
    expect(executorMsg.iteration).toBe(1);
    expect(executorMsg.task.original).toBe(task);
    expect(executorMsg.output.text).toContain("auth.ts");
    expect(executorMsg.output.files_changed).toContain("auth.ts");
    expect(executorMsg.output.files_changed).toContain("server.ts");
    expect(executorMsg.output.files_changed).toContain("routes.ts");
    expect(executorMsg.output.status).toBe("completed");
    expect(executorMsg.metadata.duration_ms).toBe(5000);
    expect(executorMsg.metadata.bytes_received).toBe(1024);

    // --- Format for reviewer ---
    const formatted = formatForReviewer(executorMsg);
    expect(formatted).toContain("Executor Output");
    expect(formatted).toContain("claude");
    expect(formatted).toContain("iteration 1");
    expect(formatted).toContain("Files Changed");
    expect(formatted).toContain("auth.ts");
    expect(formatted).toContain("Metadata");
    expect(formatted).toContain("Duration");
  });

  it("parse reviewer response with score 8, evaluate with threshold 9 -> not approved", () => {
    const reviewText = [
      "Score: 8/10",
      "",
      "Good implementation overall.",
      "",
      "## Issues",
      "- Missing input validation on user routes",
      "- No rate limiting",
      "",
      "## Suggestions",
      "- Add express-validator middleware",
      "- Implement rate limiting with express-rate-limit",
    ].join("\n");

    const reviewerMsg = parseReviewerOutput(reviewText, {
      iteration: 1,
      engine: "gemini",
      originalTask: task,
      durationMs: 3000,
      bytesReceived: 512,
    });

    // Verify parsed structure
    expect(reviewerMsg.protocol).toBe("loop-v1");
    expect(reviewerMsg.role).toBe("reviewer");
    expect(reviewerMsg.engine).toBe("gemini");
    expect(reviewerMsg.review).toBeDefined();
    expect(reviewerMsg.review!.score).toBe(8);
    expect(reviewerMsg.review!.approved).toBe(false);
    expect(reviewerMsg.review!.issues).toContain("Missing input validation on user routes");
    expect(reviewerMsg.review!.issues).toContain("No rate limiting");
    expect(reviewerMsg.review!.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(reviewerMsg.output.status).toBe("needs_revision");

    // --- Evaluate with threshold 9 -> not approved ---
    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: false };
    const result = evaluateReview(reviewerMsg.review, config);

    expect(result.approved).toBe(false);
    expect(result.score).toBe(8);
    expect(result.reason).toContain("Not approved");
    expect(result.reason).toContain("8/10");
    expect(result.reason).toContain("threshold: 9");
  });

  it("parse reviewer response with score 9, evaluate with threshold 9 -> approved", () => {
    const reviewText = [
      "Score: 9/10",
      "",
      "Excellent work!",
      "",
      "## Issues",
      "",
      "## Suggestions",
      "- Consider adding API documentation",
    ].join("\n");

    const reviewerMsg = parseReviewerOutput(reviewText, {
      iteration: 2,
      engine: "gemini",
      originalTask: task,
      durationMs: 2500,
      bytesReceived: 256,
    });

    expect(reviewerMsg.review!.score).toBe(9);
    expect(reviewerMsg.review!.approved).toBe(false); // No APPROVED keyword

    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: false };
    const result = evaluateReview(reviewerMsg.review, config);

    expect(result.approved).toBe(true);
    expect(result.score).toBe(9);
    expect(result.reason).toContain("meets threshold");
  });

  it("parse reviewer response with APPROVED keyword -> approved regardless of score", () => {
    const reviewText = [
      "Score: 6/10",
      "",
      "While the score is below threshold, the implementation meets all requirements.",
      "",
      "APPROVED",
    ].join("\n");

    const reviewerMsg = parseReviewerOutput(reviewText, {
      iteration: 3,
      engine: "gemini",
      originalTask: task,
      durationMs: 2000,
      bytesReceived: 200,
    });

    expect(reviewerMsg.review!.score).toBe(6);
    expect(reviewerMsg.review!.approved).toBe(true); // APPROVED keyword found
    expect(reviewerMsg.output.status).toBe("completed"); // approved -> completed

    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: false };
    const result = evaluateReview(reviewerMsg.review, config);

    // Approved regardless of score because of explicit APPROVED keyword
    expect(result.approved).toBe(true);
    expect(result.score).toBe(6);
    expect(result.reason).toContain("explicitly approved");
  });

  it("serialization round-trip preserves message structure", () => {
    const executorMsg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: task,
      context: "some context",
      outputText: "Created files: app.ts",
      durationMs: 1000,
      bytesReceived: 100,
    });

    // Serialize and deserialize
    const json = serializeMessage(executorMsg);
    const deserialized = deserializeMessage(json);

    expect(deserialized.protocol).toBe("loop-v1");
    expect(deserialized.role).toBe("executor");
    expect(deserialized.engine).toBe("claude");
    expect(deserialized.iteration).toBe(1);
    expect(deserialized.task.original).toBe(task);
    expect(deserialized.output.text).toBe("Created files: app.ts");
  });

  it("scoring with requireExplicitApproval: true rejects even high scores without APPROVED", () => {
    const reviewText = "Score: 10/10\n\nPerfect implementation!";

    const reviewerMsg = parseReviewerOutput(reviewText, {
      iteration: 1,
      engine: "gemini",
      originalTask: task,
      durationMs: 1000,
      bytesReceived: 50,
    });

    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: true };
    const result = evaluateReview(reviewerMsg.review, config);

    expect(result.approved).toBe(false);
    expect(result.score).toBe(10);
    expect(result.reason).toContain("did not explicitly approve");
  });

  it("scoring with undefined review returns not approved", () => {
    const config: ScoringConfig = { threshold: 9, requireExplicitApproval: false };
    const result = evaluateReview(undefined, config);

    expect(result.approved).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("No review data");
  });
});
