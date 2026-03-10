/**
 * Main iteration loop — orchestrates executor/reviewer cycles.
 *
 * Ported from iterloop's loop.ts with:
 * - scoring.ts for approval logic (not inline check)
 * - protocol.ts for message creation/parsing
 * - Shared-plan integration (import from plan/shared-plan.ts)
 * - Configurable threshold
 */

import type { Engine } from "./engine.js";
import type { ExecutionMode } from "./conversation.js";
import { runConversation } from "./conversation.js";
import {
  createExecutorMessage,
  parseReviewerOutput,
  formatForReviewer,
  type LoopMessage,
} from "./protocol.js";
import { evaluateReview, type ScoringConfig } from "./scoring.js";
import { bold, dim, success, warn, brandColor } from "../ui/colors.js";

// Shared plan functions — loaded lazily on first use to avoid race conditions.
// Gracefully degrade to no-ops if the module isn't available.
interface SharedPlanRecord {
  iteration: number;
  timestamp: string;
  executor: string;
  reviewer: string;
  executorSummary: string;
  reviewerScore: number;
  reviewerApproved: boolean;
  reviewerFeedback: string;
}

interface SharedPlanModule {
  initSharedPlan: (cwd: string, task: string) => void;
  updateSharedPlan: (cwd: string, record: SharedPlanRecord, filesChanged: string[]) => void;
  getExecutorContext: (cwd: string) => string;
  getReviewerContext: (cwd: string) => string;
}

const NO_OP_PLAN: SharedPlanModule = {
  initSharedPlan: () => {},
  updateSharedPlan: () => {},
  getExecutorContext: () => "",
  getReviewerContext: () => "",
};

// Lazy-loaded promise — awaited before first use in runLoop()
let _planModulePromise: Promise<SharedPlanModule> | null = null;

async function loadPlanModule(): Promise<SharedPlanModule> {
  if (!_planModulePromise) {
    _planModulePromise = (async () => {
      try {
        const planPath = ["../plan", "shared-plan.js"].join("/");
        const mod = (await import(planPath)) as Record<string, unknown>;
        return {
          initSharedPlan: typeof mod.initSharedPlan === "function"
            ? mod.initSharedPlan as SharedPlanModule["initSharedPlan"] : NO_OP_PLAN.initSharedPlan,
          updateSharedPlan: typeof mod.updateSharedPlan === "function"
            ? mod.updateSharedPlan as SharedPlanModule["updateSharedPlan"] : NO_OP_PLAN.updateSharedPlan,
          getExecutorContext: typeof mod.getExecutorContext === "function"
            ? mod.getExecutorContext as SharedPlanModule["getExecutorContext"] : NO_OP_PLAN.getExecutorContext,
          getReviewerContext: typeof mod.getReviewerContext === "function"
            ? mod.getReviewerContext as SharedPlanModule["getReviewerContext"] : NO_OP_PLAN.getReviewerContext,
        };
      } catch {
        return NO_OP_PLAN;
      }
    })();
  }
  return _planModulePromise;
}

// ── Public types ─────────────────────────────────────

export interface LoopOptions {
  task: string;
  maxIterations: number;
  executor: Engine;
  reviewer: Engine;
  cwd: string;
  verbose: boolean;
  mode: { current: ExecutionMode };
  passthroughArgs?: string[];
  threshold: number;
}

export interface LoopResult {
  iterations: number;
  approved: boolean;
  finalOutput: string;
  history: LoopMessage[];
}

// ── Helpers ──────────────────────────────────────────

function elapsed(startMs: number): string {
  const sec = ((Date.now() - startMs) / 1000).toFixed(1);
  return dim(`(${sec}s)`);
}

function reviewerHeader(engine: Engine): string {
  const color = engine.color;
  return color(
    `  \u250C\u2500 \u25A0 ${engine.label} (reviewer) ${"\u2500".repeat(Math.max(0, 44 - engine.label.length))}\u2510`,
  );
}

function reviewerFooter(engine: Engine, timeStr: string): string {
  const color = engine.color;
  return color(
    `  \u2514${"\u2500".repeat(42)} \u2713 done ${timeStr} \u2500\u2518`,
  );
}

// ── Main loop ────────────────────────────────────────

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const {
    task,
    maxIterations,
    executor,
    reviewer,
    cwd,
    verbose,
    mode,
    passthroughArgs,
    threshold,
  } = options;

  const revColor = brandColor(reviewer.name);
  const history: LoopMessage[] = [];

  const scoringConfig: ScoringConfig = {
    threshold,
    requireExplicitApproval: false,
  };

  // Load shared plan module (awaited — no race condition)
  const plan = await loadPlanModule();
  plan.initSharedPlan(cwd, task);

  let executorOutput = "";
  let reviewerFeedback = "";

  for (let i = 1; i <= maxIterations; i++) {
    console.log(
      bold(
        `\n  ${"\u2550".repeat(12)} Iteration ${i} / ${maxIterations} ${"\u2550".repeat(12)}\n`,
      ),
    );

    // ── Build executor prompt ──
    let initialPrompt: string;
    if (i === 1) {
      initialPrompt = task;
    } else {
      const executorContext = plan.getExecutorContext(cwd);
      initialPrompt = [
        "Please revise your previous work based on the following review feedback.",
        "",
        ...(executorContext ? [executorContext, ""] : []),
        "## Original Task",
        task,
        "",
        "## Your Previous Output",
        executorOutput,
        "",
        `## Review Feedback from ${reviewer.label}`,
        reviewerFeedback,
        "",
        "Please make corrections based on the feedback and output the complete revised result.",
      ].join("\n");
    }

    // ── Multi-turn conversation with executor ──
    const executorStartMs = Date.now();
    const conversation = await runConversation({
      engine: executor,
      initialPrompt,
      cwd,
      verbose,
      mode,
      passthroughArgs,
    });
    executorOutput = conversation.finalOutput;
    const executorDurationMs = Date.now() - executorStartMs;

    // Create structured executor message
    const executorMsg = createExecutorMessage({
      iteration: i,
      engine: executor.name,
      originalTask: task,
      context: reviewerFeedback,
      outputText: executorOutput,
      durationMs: executorDurationMs,
      bytesReceived: conversation.bytes_received,
    });
    history.push(executorMsg);

    // ── Reviewer ──
    const reviewerContext = plan.getReviewerContext(cwd);
    const reviewPrompt = [
      "You are a code review expert. Please review the following task completion.",
      "",
      ...(reviewerContext ? [reviewerContext, ""] : []),
      "## Original Task",
      task,
      "",
      formatForReviewer(executorMsg),
      "",
      "Please provide:",
      "1. Score (1-10, 10 being perfect)",
      "2. Issues found",
      "3. Specific correction suggestions",
      `4. If score >= ${threshold}, output "APPROVED" on the last line`,
    ].join("\n");

    console.log("");
    console.log(reviewerHeader(reviewer));
    console.log(revColor("  \u2502"));

    const revStart = Date.now();
    reviewerFeedback = await reviewer.run(reviewPrompt, {
      cwd,
      verbose,
      onData(chunk: string) {
        const lines = chunk.split("\n");
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];
          if (j < lines.length - 1) {
            process.stdout.write(`${revColor("  \u2502")}  ${line}\n`);
          } else if (line.length > 0) {
            process.stdout.write(`${revColor("  \u2502")}  ${line}\n`);
          }
        }
      },
    });

    console.log(revColor("  \u2502"));
    console.log(reviewerFooter(reviewer, elapsed(revStart)));

    // Parse structured reviewer output
    const reviewerMsg = parseReviewerOutput(reviewerFeedback, {
      iteration: i,
      engine: reviewer.name,
      originalTask: task,
      durationMs: Date.now() - revStart,
      bytesReceived: Buffer.byteLength(reviewerFeedback),
    });
    history.push(reviewerMsg);

    // Evaluate review using scoring module
    const scoringResult = evaluateReview(reviewerMsg.review, scoringConfig);

    // Update shared plan with iteration data
    plan.updateSharedPlan(
      cwd,
      {
        iteration: i,
        timestamp: new Date().toISOString(),
        executor: executor.name,
        reviewer: reviewer.name,
        executorSummary: executorOutput.slice(0, 500),
        reviewerScore: reviewerMsg.review?.score ?? 0,
        reviewerApproved: scoringResult.approved,
        reviewerFeedback: reviewerFeedback.slice(0, 500),
      },
      executorMsg.output.files_changed,
    );

    // ── Check approval ──
    if (scoringResult.approved) {
      console.log(
        success(
          bold(
            `\n  \u2713 ${reviewer.label} approved! ${scoringResult.reason}. Completed after iteration ${i}.\n`,
          ),
        ),
      );
      return {
        iterations: i,
        approved: true,
        finalOutput: executorOutput,
        history,
      };
    }

    if (i === maxIterations) {
      console.log(
        warn(
          `\n  \u26A0 Reached max iterations (${maxIterations}). ${scoringResult.reason}\n`,
        ),
      );
    } else {
      console.log(
        dim(
          `\n  \u2192 ${scoringResult.reason}. Proceeding to iteration ${i + 1}...\n`,
        ),
      );
    }
  }

  console.log(
    bold(
      `\n  ${"\u2550".repeat(12)} Final Result ${"\u2550".repeat(12)}\n`,
    ),
  );
  console.log(executorOutput);
  console.log("");

  return {
    iterations: maxIterations,
    approved: false,
    finalOutput: executorOutput,
    history,
  };
}
