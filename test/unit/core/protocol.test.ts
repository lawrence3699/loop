import { describe, it, expect } from "vitest";
import {
  createExecutorMessage,
  parseReviewerOutput,
  serializeMessage,
  deserializeMessage,
  formatForReviewer,
  type LoopMessage,
} from "../../../src/core/protocol.js";

describe("createExecutorMessage", () => {
  it("creates a valid LoopMessage with loop-v1 protocol", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "write tests",
      context: "some context",
      outputText: "I created file test.ts",
      durationMs: 5000,
      bytesReceived: 1234,
    });

    expect(msg.protocol).toBe("loop-v1");
    expect(msg.iteration).toBe(1);
    expect(msg.role).toBe("executor");
    expect(msg.engine).toBe("claude");
    expect(msg.task.original).toBe("write tests");
    expect(msg.task.context).toBe("some context");
    expect(msg.output.text).toBe("I created file test.ts");
    expect(msg.output.status).toBe("completed");
    expect(msg.metadata.duration_ms).toBe(5000);
    expect(msg.metadata.bytes_received).toBe(1234);
    expect(msg.timestamp).toBeTruthy();
  });

  it("extracts files changed from output text", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "I created file app.ts and modified utils.js",
      durationMs: 100,
      bytesReceived: 50,
    });

    expect(msg.output.files_changed).toContain("app.ts");
    expect(msg.output.files_changed).toContain("utils.js");
  });

  it("extracts commands executed from output text", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "$ npm test\n$ npm run build",
      durationMs: 100,
      bytesReceived: 50,
    });

    expect(msg.output.commands_executed).toContain("npm test");
    expect(msg.output.commands_executed).toContain("npm run build");
  });

  it("extracts files with various patterns", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText:
        "wrote to config.json\nediting main.ts\nwriting output.log\nRead index.ts\nEdit helper.js\nWrite data.csv",
      durationMs: 100,
      bytesReceived: 50,
    });

    const files = msg.output.files_changed;
    expect(files).toContain("config.json");
    expect(files).toContain("main.ts");
    expect(files).toContain("output.log");
    expect(files).toContain("index.ts");
    expect(files).toContain("helper.js");
    expect(files).toContain("data.csv");
  });

  it("extracts commands with running/executing prefix", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "running: tsc --build\nexecuting: node index.js\nBash npm install",
      durationMs: 100,
      bytesReceived: 50,
    });

    expect(msg.output.commands_executed).toContain("tsc --build");
    expect(msg.output.commands_executed).toContain("node index.js");
    expect(msg.output.commands_executed).toContain("npm install");
  });

  it("deduplicates extracted files", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "created file app.ts\nmodified app.ts",
      durationMs: 100,
      bytesReceived: 50,
    });

    const count = msg.output.files_changed.filter((f) => f === "app.ts").length;
    expect(count).toBe(1);
  });
});

describe("parseReviewerOutput", () => {
  const defaultParams = {
    iteration: 1,
    engine: "gemini" as const,
    originalTask: "review code",
    durationMs: 3000,
    bytesReceived: 800,
  };

  it("extracts score from 'Score: 8/10' format", () => {
    const msg = parseReviewerOutput("Score: 8/10\nLooks good.", defaultParams);
    expect(msg.review?.score).toBe(8);
  });

  it("extracts score from 'rating: 7' format", () => {
    const msg = parseReviewerOutput("rating: 7\nNeeds work.", defaultParams);
    expect(msg.review?.score).toBe(7);
  });

  it("extracts score from '9/10' format", () => {
    const msg = parseReviewerOutput("Overall: 9/10", defaultParams);
    expect(msg.review?.score).toBe(9);
  });

  it("returns score 0 when no score found", () => {
    const msg = parseReviewerOutput("No numeric score here.", defaultParams);
    expect(msg.review?.score).toBe(0);
  });

  it("clamps score to max 10", () => {
    const msg = parseReviewerOutput("Score: 15/10", defaultParams);
    expect(msg.review?.score).toBe(10);
  });

  it("clamps score to min 1 when numeric", () => {
    const msg = parseReviewerOutput("Score: 0/10", defaultParams);
    expect(msg.review?.score).toBe(1);
  });

  it("detects APPROVED keyword", () => {
    const msg = parseReviewerOutput("Score: 10/10\nAPPROVED\n", defaultParams);
    expect(msg.review?.approved).toBe(true);
    expect(msg.output.status).toBe("completed");
  });

  it("does not detect APPROVED when inline with other text", () => {
    const msg = parseReviewerOutput("Not APPROVED yet.\nScore: 5", defaultParams);
    expect(msg.review?.approved).toBe(false);
  });

  it("sets status to needs_revision when not approved", () => {
    const msg = parseReviewerOutput("Score: 5\nNeeds fixes.", defaultParams);
    expect(msg.output.status).toBe("needs_revision");
  });

  it("extracts issues section", () => {
    const msg = parseReviewerOutput(
      "Score: 6\n\n## Issues\n- Missing tests\n- No error handling\n\n## Other",
      defaultParams,
    );
    expect(msg.review?.issues).toEqual(["Missing tests", "No error handling"]);
  });

  it("extracts suggestions section", () => {
    const msg = parseReviewerOutput(
      "Score: 7\n\nSuggestions:\n- Add logging\n- Refactor utils\n",
      defaultParams,
    );
    expect(msg.review?.suggestions).toEqual(["Add logging", "Refactor utils"]);
  });

  it("returns empty arrays when no issues/suggestions sections", () => {
    const msg = parseReviewerOutput("Score: 8\nAll good.", defaultParams);
    expect(msg.review?.issues).toEqual([]);
    expect(msg.review?.suggestions).toEqual([]);
  });

  it("creates valid LoopMessage structure", () => {
    const msg = parseReviewerOutput("Score: 9\nAPPROVED", defaultParams);
    expect(msg.protocol).toBe("loop-v1");
    expect(msg.role).toBe("reviewer");
    expect(msg.engine).toBe("gemini");
    expect(msg.iteration).toBe(1);
  });

  it("handles empty output", () => {
    const msg = parseReviewerOutput("", defaultParams);
    expect(msg.review?.score).toBe(0);
    expect(msg.review?.approved).toBe(false);
    expect(msg.review?.issues).toEqual([]);
    expect(msg.review?.suggestions).toEqual([]);
  });
});

describe("serializeMessage / deserializeMessage", () => {
  it("round-trips a message", () => {
    const original = createExecutorMessage({
      iteration: 2,
      engine: "gemini",
      originalTask: "build app",
      context: "ctx",
      outputText: "done",
      durationMs: 1000,
      bytesReceived: 500,
    });

    const json = serializeMessage(original);
    const restored = deserializeMessage(json);

    expect(restored.protocol).toBe("loop-v1");
    expect(restored.iteration).toBe(2);
    expect(restored.engine).toBe("gemini");
    expect(restored.output.text).toBe("done");
  });

  it("throws on unknown protocol", () => {
    expect(() =>
      deserializeMessage(JSON.stringify({ protocol: "unknown-v1" })),
    ).toThrow("Unknown protocol");
  });

  it("throws on non-object JSON", () => {
    expect(() => deserializeMessage('"just a string"')).toThrow("Unknown protocol");
  });

  it("throws on invalid JSON", () => {
    expect(() => deserializeMessage("not json")).toThrow();
  });
});

describe("formatForReviewer", () => {
  it("produces readable markdown with executor output", () => {
    const msg = createExecutorMessage({
      iteration: 3,
      engine: "claude",
      originalTask: "refactor",
      context: "",
      outputText: "Refactored the codebase.",
      durationMs: 12000,
      bytesReceived: 2048,
    });

    const formatted = formatForReviewer(msg);

    expect(formatted).toContain("## Executor Output (claude, iteration 3)");
    expect(formatted).toContain("Refactored the codebase.");
    expect(formatted).toContain("## Metadata");
    expect(formatted).toContain("Duration: 12.0s");
    expect(formatted).toContain("2048 bytes");
  });

  it("includes files changed section when present", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "created file app.ts",
      durationMs: 100,
      bytesReceived: 50,
    });

    const formatted = formatForReviewer(msg);
    expect(formatted).toContain("## Files Changed");
    expect(formatted).toContain("- app.ts");
  });

  it("includes commands executed section when present", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "$ npm test",
      durationMs: 100,
      bytesReceived: 50,
    });

    const formatted = formatForReviewer(msg);
    expect(formatted).toContain("## Commands Executed");
    expect(formatted).toContain("- npm test");
  });

  it("omits files changed section when empty", () => {
    const msg = createExecutorMessage({
      iteration: 1,
      engine: "claude",
      originalTask: "task",
      context: "",
      outputText: "Nothing special happened",
      durationMs: 100,
      bytesReceived: 50,
    });

    const formatted = formatForReviewer(msg);
    expect(formatted).not.toContain("## Files Changed");
  });
});
