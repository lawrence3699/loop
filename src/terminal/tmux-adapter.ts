/**
 * tmux pane adapter.
 *
 * Spawns commands inside tmux panes using `tmux split-window` and supports
 * text injection via `tmux send-keys`.
 *
 * Ported from ufoo's adapters/tmuxAdapter.js.
 */

import { execFile, spawn } from "node:child_process";
import type {
  AdapterLaunchOptions,
  LaunchedProcess,
  TerminalAdapter,
  TerminalCapabilities,
} from "./adapter.js";
import type { LaunchMode } from "./detect.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmuxCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout ?? "").trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class TmuxAdapter implements TerminalAdapter {
  readonly mode: LaunchMode = "tmux";

  readonly capabilities: TerminalCapabilities = {
    supportsActivate: true,
    supportsInjection: true,
    supportsSessionReuse: true,
    supportsResize: true,
  };

  async launch(
    command: string,
    args: string[],
    opts: AdapterLaunchOptions,
  ): Promise<LaunchedProcess> {
    // Shell-quote each argument to prevent injection when tmux interprets
    // the command string via the shell.
    const shellQuote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
    const fullCommand = [command, ...args].map(shellQuote).join(" ");

    // Split a new pane and run the command.  tmux split-window returns the
    // pane ID (e.g. %5) when using -P -F.
    const paneId = await tmuxCommand([
      "split-window",
      "-h",
      "-c",
      opts.cwd,
      "-P",
      "-F",
      "#{pane_id}",
      fullCommand,
    ]);

    // Resolve the PID of the initial command running inside the new pane.
    let pid = 0;
    try {
      const pidStr = await tmuxCommand([
        "display-message",
        "-t",
        paneId,
        "-p",
        "#{pane_pid}",
      ]);
      pid = Number.parseInt(pidStr, 10) || 0;
    } catch {
      // Non-fatal — PID tracking is best-effort
    }

    // We also spawn the command locally so we can attach I/O handlers.
    // This mirrors what the terminal-adapter does: osascript opens the
    // window, but a local child_process tracks the lifecycle.
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const dataHandlers: Array<(data: string) => void> = [];
    const exitHandlers: Array<(code: number) => void> = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const h of dataHandlers) h(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const h of dataHandlers) h(text);
    });
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      for (const h of exitHandlers) h(exitCode);
    });

    const effectivePid = child.pid ?? pid;

    return {
      pid: effectivePid,
      write(data: string) {
        child.stdin?.write(data);
      },
      resize(cols: number, rows: number) {
        // Resize the tmux pane
        tmuxCommand(["resize-pane", "-t", paneId, "-x", String(cols), "-y", String(rows)]).catch(
          () => {
            // Resize failure is non-fatal
          },
        );
      },
      kill() {
        child.kill();
        // Also kill the tmux pane to avoid orphans
        tmuxCommand(["kill-pane", "-t", paneId]).catch(() => {
          // Best-effort cleanup
        });
      },
      onData(handler: (data: string) => void) {
        dataHandlers.push(handler);
      },
      onExit(handler: (code: number) => void) {
        exitHandlers.push(handler);
      },
    };
  }

  async inject(processOrId: number | string, command: string): Promise<void> {
    const target = String(processOrId);
    // Use tmux send-keys to inject text. We send the text first, then Enter.
    await tmuxCommand(["send-keys", "-t", target, command, "Enter"]);
  }

  async activate(processOrId: number | string): Promise<void> {
    const target = String(processOrId);
    await tmuxCommand(["select-pane", "-t", target]);
  }
}
