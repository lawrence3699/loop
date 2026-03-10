#!/usr/bin/env node

import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bold, red, yellow, green } from "./ui/colors.js";
import { type EngineName, ENGINE_NAMES } from "./config/schema.js";
import { loadConfig } from "./config/index.js";
import { interactive } from "./ui/interactive.js";
import { showPlan, clearPlan } from "./plan/shared-plan.js";
import { addDecision, listDecisions, resolveDecision } from "./plan/decisions.js";
import { SkillRegistry } from "./skills/registry.js";
import { runLoop } from "./core/loop.js";
import { createEngine } from "./core/engine.js";
import { EventBus } from "./bus/event-bus.js";
import { OrchestratorDaemon } from "./orchestrator/daemon.js";

const program = new Command();

program
  .name("loop")
  .description("Iterative multi-engine AI orchestration CLI — Claude, Gemini, Codex")
  .version("0.1.0")
  .argument("[task]", "Task description (omit to enter interactive mode)")
  .option("-e, --executor <engine>", "Executor engine: claude | gemini | codex")
  .option("-r, --reviewer <engine>", "Reviewer engine: claude | gemini | codex")
  .option("-n, --iterations <number>", "Max number of iterations")
  .option("-d, --dir <path>", "Working directory")
  .option("-v, --verbose", "Stream real-time output from CLI tools")
  .option("--auto", "Auto mode: skip manual conversation, auto-submit to reviewer")
  .option("--pass <args...>", "Pass native flags to executor CLI")
  .option("--threshold <number>", "Approval score threshold (1-10)")
  .action(
    async (
      task: string | undefined,
      options: {
        executor?: string;
        reviewer?: string;
        iterations?: string;
        dir?: string;
        verbose?: boolean;
        auto?: boolean;
        pass?: string[];
        threshold?: string;
      },
    ) => {
      try {
        const config = await loadConfig(options.dir ?? process.cwd());

        if (!task) {
          // Interactive mode
          const interactiveConfig = await interactive();
          if (!interactiveConfig) process.exit(0);

          const execName = interactiveConfig.executor as EngineName;
          const revName = interactiveConfig.reviewer as EngineName;

          console.log(bold("\n  Preflight check...\n"));
          await preflight(execName, revName);

          await runLoop({
            task: interactiveConfig.task,
            maxIterations: interactiveConfig.iterations,
            threshold: interactiveConfig.threshold,
            executor: createEngine(execName),
            reviewer: createEngine(revName),
            cwd: interactiveConfig.dir,
            verbose: interactiveConfig.verbose,
            mode: { current: interactiveConfig.mode as "auto" | "manual" },
            passthroughArgs: interactiveConfig.passthroughArgs,
          });
        } else {
          // Command-line mode
          const executorName = (options.executor ?? config.defaultExecutor) as EngineName;
          const reviewerName = (options.reviewer ?? config.defaultReviewer) as EngineName;

          if (!ENGINE_NAMES.includes(executorName)) {
            console.error(
              red(`Invalid executor: ${options.executor}. Choose: claude | gemini | codex`),
            );
            process.exit(1);
          }
          if (!ENGINE_NAMES.includes(reviewerName)) {
            console.error(
              red(`Invalid reviewer: ${options.reviewer}. Choose: claude | gemini | codex`),
            );
            process.exit(1);
          }

          const iterations = options.iterations
            ? parseInt(options.iterations, 10)
            : config.maxIterations;
          if (isNaN(iterations) || iterations < 1 || iterations > 20) {
            console.error(red("Invalid iterations: must be between 1 and 20"));
            process.exit(1);
          }

          const threshold = options.threshold
            ? parseInt(options.threshold, 10)
            : config.threshold;
          if (isNaN(threshold) || threshold < 1 || threshold > 10) {
            console.error(red("Invalid threshold: must be between 1 and 10"));
            process.exit(1);
          }

          const modeValue = options.auto ? "auto" : config.mode;

          if (options.dir && !existsSync(options.dir)) {
            console.error(red(`Invalid directory: ${options.dir} does not exist`));
            process.exit(1);
          }

          if (executorName === reviewerName) {
            console.log(
              yellow(
                `\n  Warning: executor and reviewer are both "${executorName}". Using different engines is recommended.\n`,
              ),
            );
          }

          console.log(bold("\n  Preflight check...\n"));
          await preflight(executorName, reviewerName);

          const cwd = options.dir ? resolve(options.dir) : process.cwd();

          console.log(bold("\n  Starting loop\n"));
          console.log(`  Executor:    ${executorName}`);
          console.log(`  Reviewer:    ${reviewerName}`);
          console.log(`  Task:        ${task}`);
          console.log(`  Iterations:  ${iterations}`);
          console.log(`  Threshold:   ${threshold}`);
          console.log(`  Directory:   ${cwd}`);
          console.log(`  Verbose:     ${options.verbose ? "on" : "off"}`);
          console.log(
            `  Mode:        ${modeValue === "auto" ? "\u23F5\u23F5 Auto" : "\u23F5\u23F5 Manual"}`,
          );

          await runLoop({
            task,
            maxIterations: iterations,
            threshold,
            executor: createEngine(executorName),
            reviewer: createEngine(reviewerName),
            cwd,
            verbose: options.verbose ?? false,
            mode: { current: modeValue as "auto" | "manual" },
            passthroughArgs: options.pass,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(red(`\n  Error: ${msg}`));
        process.exit(1);
      }
    },
  );

// ── Subcommand: daemon ──────────────────────────────

const daemon = program.command("daemon").description("Daemon management");

daemon
  .command("start")
  .description("Start the loop daemon")
  .action(async () => {
    try {
      const cwd = process.cwd();
      const mgr = new OrchestratorDaemon(cwd);
      console.log(bold("  Starting daemon..."));
      await mgr.start();
      console.log(green("  Daemon started (pid=" + process.pid + ")"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

daemon
  .command("stop")
  .description("Stop the loop daemon")
  .action(async () => {
    try {
      const cwd = process.cwd();
      const mgr = new OrchestratorDaemon(cwd);
      if (!mgr.isRunning()) {
        console.log(yellow("  Daemon is not running."));
        return;
      }
      await mgr.stop();
      console.log(green("  Daemon stopped."));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

daemon
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    try {
      const cwd = process.cwd();
      const mgr = new OrchestratorDaemon(cwd);
      if (!mgr.isRunning()) {
        console.log(yellow("  Daemon is not running."));
        return;
      }
      const status = await mgr.getStatus();
      console.log(bold("  Daemon status:"));
      console.log(`  PID:       ${status.pid}`);
      console.log(`  Uptime:    ${status.uptime}s`);
      console.log(`  Agents:    ${status.agents}`);
      console.log(`  Events:    ${status.busEvents}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

// ── Subcommand: bus ─────────────────────────────────

const bus = program.command("bus").description("Event bus operations");

bus
  .command("send <message>")
  .description("Send a message on the event bus")
  .option("-t, --target <id>", "Target subscriber ID", "*")
  .action(async (message: string, opts: { target?: string }) => {
    try {
      const cwd = process.cwd();
      const eventBus = new EventBus(cwd);
      await eventBus.init();
      const target = opts.target ?? "*";
      const event = target === "*"
        ? await eventBus.broadcast("cli", message)
        : await eventBus.send("cli", target, message);
      console.log(green(`  Sent (seq=${event.seq}, target=${event.target})`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

bus
  .command("check <subscriberId>")
  .description("Check for pending bus messages")
  .action(async (subscriberId: string) => {
    try {
      const cwd = process.cwd();
      const eventBus = new EventBus(cwd);
      await eventBus.init();
      const events = await eventBus.check(subscriberId);
      if (events.length === 0) {
        console.log("  No pending messages.");
        return;
      }
      console.log(bold(`  Pending messages (${events.length}):\n`));
      for (const e of events) {
        console.log(`  [${e.seq}] ${e.publisher} → ${e.target}: ${JSON.stringify(e.data)}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

bus
  .command("status")
  .description("Show event bus status")
  .action(async () => {
    try {
      const cwd = process.cwd();
      const eventBus = new EventBus(cwd);
      await eventBus.init();
      const status = await eventBus.status();
      console.log(bold("  Bus status:"));
      console.log(`  Workspace:  ${status.id}`);
      console.log(`  Agents:     ${status.agents}`);
      console.log(`  Events:     ${status.events}`);
      if (status.agentList.length > 0) {
        console.log(bold("\n  Agents:"));
        for (const a of status.agentList) {
          console.log(`    ${a.id} [${a.type}] ${a.nickname || ""} — ${a.status}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`  Error: ${msg}`));
      process.exit(1);
    }
  });

// ── Subcommand: chat ────────────────────────────────

program
  .command("chat")
  .description("Interactive dashboard")
  .action(async () => {
    const { Dashboard } = await import("./ui/dashboard.js");
    const dashboard = new Dashboard();
    dashboard.start();
  });

// ── Subcommand: plan ────────────────────────────────

const plan = program.command("plan").description("Plan management");

plan
  .command("show")
  .description("Show the current shared plan")
  .action(async () => {
    const cwd = process.cwd();
    const content = await showPlan(cwd);
    console.log(content);
  });

plan
  .command("clear")
  .description("Clear the shared plan")
  .action(async () => {
    const cwd = process.cwd();
    await clearPlan(cwd);
    console.log(green("  Plan cleared."));
  });

// ── Subcommand: ctx (decisions) ─────────────────────

const ctx = program.command("ctx").description("Decision tracking");

ctx
  .command("add <title>")
  .description("Add a new decision")
  .option("-s, --status <status>", "Initial status: proposed | accepted", "proposed")
  .option("--context <text>", "Decision context")
  .option("--decision <text>", "The decision itself")
  .option("--consequences <text>", "Consequences of the decision")
  .action(
    async (
      title: string,
      opts: {
        status?: string;
        context?: string;
        decision?: string;
        consequences?: string;
      },
    ) => {
      const cwd = process.cwd();
      const status =
        opts.status === "accepted" ||
        opts.status === "proposed" ||
        opts.status === "rejected" ||
        opts.status === "superseded"
          ? opts.status
          : "proposed";

      const decision = await addDecision(cwd, {
        title,
        status: status as "proposed" | "accepted" | "rejected" | "superseded",
        context: opts.context ?? "",
        decision: opts.decision ?? "",
        consequences: opts.consequences ?? "",
      });
      console.log(green(`  Created decision #${decision.id}: ${decision.title}`));
    },
  );

ctx
  .command("list")
  .description("List all decisions")
  .option("-s, --status <status>", "Filter by status")
  .action(async (opts: { status?: string }) => {
    const cwd = process.cwd();
    const decisions = await listDecisions(cwd);

    const filtered = opts.status
      ? decisions.filter((d) => d.status === opts.status)
      : decisions;

    if (filtered.length === 0) {
      console.log("  No decisions found.");
      return;
    }

    console.log(bold(`  Decisions (${filtered.length}):\n`));
    for (const d of filtered) {
      const statusColor =
        d.status === "accepted"
          ? green
          : d.status === "rejected"
            ? red
            : yellow;
      console.log(
        `  #${d.id}  [${statusColor(d.status.toUpperCase())}]  ${d.title}  ${d.date}`,
      );
    }
  });

ctx
  .command("resolve <id>")
  .description("Resolve a decision")
  .option(
    "-s, --status <status>",
    "New status: accepted | rejected | superseded",
    "accepted",
  )
  .action(async (id: string, opts: { status?: string }) => {
    const cwd = process.cwd();
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      console.error(red("  Invalid decision ID"));
      process.exit(1);
    }

    const status =
      opts.status === "accepted" ||
      opts.status === "rejected" ||
      opts.status === "superseded"
        ? opts.status
        : "accepted";

    await resolveDecision(
      cwd,
      numId,
      status as "accepted" | "rejected" | "superseded",
    );
    console.log(green(`  Decision #${numId} resolved as ${status}`));
  });

// ── Subcommand: skills ──────────────────────────────

const skills = program.command("skills").description("Skills management");

skills
  .command("list")
  .description("List available skills")
  .action(async () => {
    const cwd = process.cwd();
    const registry = new SkillRegistry();
    await registry.load(cwd);
    const all = registry.list();

    if (all.length === 0) {
      console.log("  No skills found.");
      return;
    }

    console.log(bold(`  Skills (${all.length}):\n`));
    for (const s of all) {
      const scope = `[${s.scope}]`.padEnd(10);
      console.log(`  ${scope} ${bold(s.name)}  ${s.description}`);
    }
  });

skills
  .command("add <name>")
  .description("Add a new skill")
  .option("--global", "Add as global skill")
  .option("--content <text>", "Skill content (markdown)")
  .action(async (name: string, opts: { global?: boolean; content?: string }) => {
    const cwd = process.cwd();
    const scope = opts.global ? "global" : "project";
    const content = opts.content ?? `# ${name}\n\nSkill content here.\n`;

    const registry = new SkillRegistry();
    await registry.add(name, content, scope as "global" | "project", cwd);
    console.log(green(`  Added skill: ${name} (${scope})`));
  });

// ── Preflight check ─────────────────────────────────

async function preflight(
  executor: EngineName,
  reviewer: EngineName,
): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const names = [...new Set([executor, reviewer])];
  let ok = true;

  for (const name of names) {
    try {
      const version = execFileSync(name, ["--version"], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      console.log(green(`  \u2713 ${name}`) + `  ${version}`);
    } catch {
      console.error(red(`  \u2717 ${name} CLI not found`));
      ok = false;
    }
  }

  if (!ok) {
    throw new Error(
      "Required engine CLI(s) not found. Please install them and try again.",
    );
  }
}

// ── Parse and run ───────────────────────────────────

program.parse();
