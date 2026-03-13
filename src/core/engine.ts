/**
 * Engine abstraction — unified interface for Claude, Gemini, and Codex CLIs.
 *
 * Ported from iterloop's engine.ts with adaptations for iter-loop:
 * - Brand `color` property on each engine
 * - Timeout parameter on RunOptions
 * - ESM imports with .js extensions
 */

import { spawn, execFileSync } from "node:child_process";
import { stripAnsi } from "../utils/ansi.js";
import { createPtySession, type PtySession, type PtySessionOptions } from "../agent/pty-session.js";
import { claude as claudeColor, gemini as geminiColor, codex as codexColor } from "../ui/colors.js";
import {
  runClaudeTtyCapture,
  runGeminiTtyCapture,
  supportsTtyCapturedExecution,
  type RuntimeProgressEvent,
} from "./runtime.js";

// Re-export PtySession types for consumer convenience
export type { PtySession, PtySessionOptions };

const DEFAULT_TIMEOUT = 3_600_000; // 1 hour

// ── Public types ─────────────────────────────────────

export type EngineName = "claude" | "gemini" | "codex";

export const ENGINE_NAMES: EngineName[] = ["claude", "gemini", "codex"];

export interface RunOptions {
  cwd?: string;
  verbose?: boolean;
  onData?: (chunk: string) => void;
  onStatus?: (status: string) => void;
  onProgress?: (event: RuntimeProgressEvent) => void;
  passthroughArgs?: string[];
  timeout?: number;
}

export interface InteractiveOptions {
  cwd?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  onData?: (data: string) => void;
  onExit?: (exitCode: number) => void;
  passthroughArgs?: string[];
}

export interface Engine {
  name: EngineName;
  label: string;
  color: (s: string) => string;
  checkVersion(): string;
  run(prompt: string, opts: RunOptions): Promise<string>;
  interactive(opts: InteractiveOptions): PtySession;
}

export type RunTransport = "pipe" | "tty-capture" | "unsupported";

export function selectRunTransport(engineName: EngineName): RunTransport {
  switch (engineName) {
    case "claude":
    case "gemini":
      return supportsTtyCapturedExecution() ? "tty-capture" : "unsupported";
    case "codex":
      return "pipe";
  }
}

function unsupportedTransportError(engineName: "claude" | "gemini"): Error {
  return new Error(
    `${engineName} requires an interactive terminal in the current runtime. ` +
    "Pipe-based execution is disabled because it hangs on this machine.",
  );
}

function emitProgress(
  opts: RunOptions,
  event: RuntimeProgressEvent,
): void {
  opts.onProgress?.(event);
}

// ── Claude ───────────────────────────────────────────

function createClaude(): Engine {
  return {
    name: "claude",
    label: "Claude",
    color: claudeColor,

    checkVersion() {
      return execFileSync("claude", ["--version"], { encoding: "utf-8" }).trim();
    },

    run(prompt, opts) {
      const transport = selectRunTransport("claude");
      if (transport === "tty-capture") {
        emitProgress(opts, {
          phase: "transport",
          summary: "Selected executor transport",
          transport: "tty-capture",
          detail: "claude",
        });
        return runClaudeTtyCapture(prompt, opts);
      }
      emitProgress(opts, {
        phase: "transport",
        summary: "Interactive terminal required",
        transport: "unsupported",
      });
      return Promise.reject(unsupportedTransportError("claude"));
    },

    interactive(opts) {
      return createPtySession({
        cmd: "claude",
        args: [...(opts.passthroughArgs ?? [])],
        cwd: opts.cwd ?? process.cwd(),
        env: opts.env,
        engineName: "claude",
        onData: opts.onData,
        onExit: opts.onExit,
      });
    },
  };
}

// ── Gemini ───────────────────────────────────────────

function createGemini(): Engine {
  return {
    name: "gemini",
    label: "Gemini",
    color: geminiColor,

    checkVersion() {
      return execFileSync("gemini", ["--version"], { encoding: "utf-8" }).trim();
    },

    run(prompt, opts) {
      const transport = selectRunTransport("gemini");
      if (transport === "tty-capture") {
        emitProgress(opts, {
          phase: "transport",
          summary: "Selected executor transport",
          transport: "tty-capture",
          detail: "gemini",
        });
        return runGeminiTtyCapture(prompt, opts);
      }
      emitProgress(opts, {
        phase: "transport",
        summary: "Interactive terminal required",
        transport: "unsupported",
      });
      return Promise.reject(unsupportedTransportError("gemini"));
    },

    interactive(opts) {
      return createPtySession({
        cmd: "gemini",
        args: [...(opts.passthroughArgs ?? [])],
        cwd: opts.cwd ?? process.cwd(),
        env: opts.env,
        engineName: "gemini",
        onData: opts.onData,
        onExit: opts.onExit,
      });
    },
  };
}

// ── Codex ────────────────────────────────────────────

function createCodex(): Engine {
  return {
    name: "codex",
    label: "Codex",
    color: codexColor,

    checkVersion() {
      return execFileSync("codex", ["--version"], { encoding: "utf-8" }).trim();
    },

    run(prompt, opts) {
      const args = ["exec", "--full-auto", "--skip-git-repo-check"];
      if (opts.cwd) {
        args.push("-C", opts.cwd);
      }
      args.push(...(opts.passthroughArgs ?? []), prompt);
      return spawnEngine("codex", args, opts);
    },

    interactive(opts) {
      return createPtySession({
        cmd: "codex",
        args: [...(opts.passthroughArgs ?? [])],
        cwd: opts.cwd ?? process.cwd(),
        env: opts.env,
        engineName: "codex",
        onData: opts.onData,
        onExit: opts.onExit,
      });
    },
  };
}

// ── Factory ──────────────────────────────────────────

export function createEngine(name: EngineName): Engine {
  switch (name) {
    case "claude":
      return createClaude();
    case "gemini":
      return createGemini();
    case "codex":
      return createCodex();
  }
}

// ── Shared spawn helper ──────────────────────────────

function spawnEngine(
  cmd: string,
  args: string[],
  opts: RunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let sawOutput = false;

    emitProgress(opts, {
      phase: "transport",
      summary: "Selected executor transport",
      transport: "pipe",
      detail: cmd,
    });

    const proc = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    emitProgress(opts, {
      phase: "startup",
      summary: "Starting engine process",
      transport: "pipe",
    });

    let stdout = "";
    let stderr = "";

    const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT;
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`${cmd} timed out (${Math.round(timeoutMs / 60_000)} minute limit)`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!sawOutput) {
        sawOutput = true;
        emitProgress(opts, {
          phase: "stream",
          summary: "Engine output detected",
          transport: "pipe",
        });
      }
      if (opts.onData) {
        opts.onData(text);
      } else if (opts.verbose) {
        process.stdout.write(text);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (opts.verbose) {
        process.stderr.write(text);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
      } else {
        const output = stripAnsi(stdout).trim();
        emitProgress(opts, {
          phase: "complete",
          summary: "Engine run complete",
          transport: "pipe",
          elapsedMs: Date.now() - startedAt,
          bytes: Buffer.byteLength(output),
        });
        resolve(output);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
