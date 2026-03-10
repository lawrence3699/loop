import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Engine, EngineName, RunOptions, InteractiveOptions } from "../../src/core/engine.js";
import type { PtySession } from "../../src/core/engine.js";
import {
  createExecutorMessage,
  parseReviewerOutput,
  formatForReviewer,
  type LoopMessage,
} from "../../src/core/protocol.js";
import { evaluateReview, type ScoringConfig } from "../../src/core/scoring.js";

/**
 * Create a mock Engine that returns canned responses sequentially.
 */
function createMockEngine(name: string, responses: string[]): Engine {
  let callIndex = 0;
  return {
    name: name as EngineName,
    label: `Mock ${name}`,
    color: (s: string) => s,
    checkVersion: () => "mock-1.0.0",
    run: async (_prompt: string, _opts: RunOptions) => {
      const response = responses[callIndex % responses.length];
      callIndex++;
      return response;
    },
    interactive: (_opts: InteractiveOptions): PtySession => {
      throw new Error("Not implemented in mock");
    },
  };
}

describe("Loop Flow (integration)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-flow-integ-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("simulates a 2-iteration loop with mock engines: score below threshold, then approved", async () => {
    const task = "Create a REST API with Express";
    const threshold = 9;

    const executorResponses = [
      "I created app.ts and modified routes.ts to add the API endpoints.",
      "I created app.test.ts and modified routes.test.ts with unit tests.",
    ];

    const reviewerResponses = [
      "Score: 7/10\n\n## Issues\n- Missing tests\n\n## Suggestions\n- Add unit tests\n\nNot yet approved.",
      "Score: 9/10\n\nGreat improvement!\n\nAPPROVED",
    ];

    const executor = createMockEngine("claude", executorResponses);
    const reviewer = createMockEngine("gemini", reviewerResponses);

    const scoringConfig: ScoringConfig = {
      threshold,
      requireExplicitApproval: false,
    };

    const history: LoopMessage[] = [];
    let iterations = 0;
    let approved = false;
    let executorOutput = "";
    let reviewerFeedback = "";

    // Simulate the loop manually (2 iterations)
    for (let i = 1; i <= 5; i++) {
      // Build executor prompt
      let executorPrompt: string;
      if (i === 1) {
        executorPrompt = task;
      } else {
        executorPrompt = [
          "Please revise your previous work based on the following review feedback.",
          "",
          "## Original Task",
          task,
          "",
          "## Your Previous Output",
          executorOutput,
          "",
          `## Review Feedback from ${reviewer.label}`,
          reviewerFeedback,
        ].join("\n");
      }

      // Run executor
      const execStartMs = Date.now();
      executorOutput = await executor.run(executorPrompt, { cwd: tmpDir });
      const execDurationMs = Date.now() - execStartMs;

      // Create structured executor message
      const executorMsg = createExecutorMessage({
        iteration: i,
        engine: executor.name,
        originalTask: task,
        context: reviewerFeedback,
        outputText: executorOutput,
        durationMs: execDurationMs,
        bytesReceived: Buffer.byteLength(executorOutput),
      });
      history.push(executorMsg);

      // Build reviewer prompt
      const reviewPrompt = [
        "You are a code review expert. Please review the following task completion.",
        "",
        "## Original Task",
        task,
        "",
        formatForReviewer(executorMsg),
      ].join("\n");

      // Run reviewer
      const revStartMs = Date.now();
      reviewerFeedback = await reviewer.run(reviewPrompt, { cwd: tmpDir });
      const revDurationMs = Date.now() - revStartMs;

      // Parse structured reviewer output
      const reviewerMsg = parseReviewerOutput(reviewerFeedback, {
        iteration: i,
        engine: reviewer.name,
        originalTask: task,
        durationMs: revDurationMs,
        bytesReceived: Buffer.byteLength(reviewerFeedback),
      });
      history.push(reviewerMsg);

      // Evaluate review
      const scoringResult = evaluateReview(reviewerMsg.review, scoringConfig);
      iterations = i;

      if (scoringResult.approved) {
        approved = true;
        break;
      }
    }

    // --- Verify: 2 iterations completed ---
    expect(iterations).toBe(2);

    // --- Verify: approved === true ---
    expect(approved).toBe(true);

    // --- Verify: history has 4 messages (2 executor + 2 reviewer) ---
    expect(history).toHaveLength(4);

    // --- Verify protocol messages have correct structure ---
    // Executor messages
    const exec1 = history[0];
    expect(exec1.protocol).toBe("loop-v1");
    expect(exec1.role).toBe("executor");
    expect(exec1.engine).toBe("claude");
    expect(exec1.iteration).toBe(1);
    expect(exec1.output.text).toBe("I created app.ts and modified routes.ts to add the API endpoints.");
    expect(exec1.output.status).toBe("completed");
    expect(exec1.task.original).toBe(task);

    const exec2 = history[2];
    expect(exec2.protocol).toBe("loop-v1");
    expect(exec2.role).toBe("executor");
    expect(exec2.iteration).toBe(2);

    // Reviewer messages
    const rev1 = history[1];
    expect(rev1.protocol).toBe("loop-v1");
    expect(rev1.role).toBe("reviewer");
    expect(rev1.engine).toBe("gemini");
    expect(rev1.iteration).toBe(1);
    expect(rev1.review).toBeDefined();
    expect(rev1.review!.score).toBe(7);
    expect(rev1.review!.approved).toBe(false);
    expect(rev1.review!.issues).toContain("Missing tests");
    expect(rev1.review!.suggestions).toContain("Add unit tests");
    expect(rev1.output.status).toBe("needs_revision");

    const rev2 = history[3];
    expect(rev2.protocol).toBe("loop-v1");
    expect(rev2.role).toBe("reviewer");
    expect(rev2.iteration).toBe(2);
    expect(rev2.review).toBeDefined();
    expect(rev2.review!.score).toBe(9);
    expect(rev2.review!.approved).toBe(true);
    expect(rev2.output.status).toBe("completed");

    // Verify files_changed extraction from executor output
    // The regex extracts filenames from patterns like "created app.ts" and "modified routes.ts"
    expect(exec1.output.files_changed).toContain("app.ts");
    expect(exec1.output.files_changed).toContain("routes.ts");
  });

  it("stops at maxIterations when never approved", async () => {
    const task = "Build something";
    const maxIterations = 2;

    const executor = createMockEngine("claude", ["Some output"]);
    const reviewer = createMockEngine("gemini", [
      "Score: 3/10\n\n## Issues\n- Terrible code\n\n## Suggestions\n- Rewrite everything",
    ]);

    const scoringConfig: ScoringConfig = {
      threshold: 9,
      requireExplicitApproval: false,
    };

    const history: LoopMessage[] = [];
    let iterations = 0;
    let approved = false;
    let executorOutput = "";
    let reviewerFeedback = "";

    for (let i = 1; i <= maxIterations; i++) {
      executorOutput = await executor.run(task, { cwd: tmpDir });
      const executorMsg = createExecutorMessage({
        iteration: i,
        engine: executor.name,
        originalTask: task,
        context: reviewerFeedback,
        outputText: executorOutput,
        durationMs: 100,
        bytesReceived: Buffer.byteLength(executorOutput),
      });
      history.push(executorMsg);

      reviewerFeedback = await reviewer.run(formatForReviewer(executorMsg), { cwd: tmpDir });
      const reviewerMsg = parseReviewerOutput(reviewerFeedback, {
        iteration: i,
        engine: reviewer.name,
        originalTask: task,
        durationMs: 50,
        bytesReceived: Buffer.byteLength(reviewerFeedback),
      });
      history.push(reviewerMsg);

      const result = evaluateReview(reviewerMsg.review, scoringConfig);
      iterations = i;

      if (result.approved) {
        approved = true;
        break;
      }
    }

    expect(iterations).toBe(maxIterations);
    expect(approved).toBe(false);
    expect(history).toHaveLength(4); // 2 iterations * 2 messages each
  });
});
