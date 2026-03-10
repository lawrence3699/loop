/**
 * Native Terminal.app adapter (macOS).
 *
 * Opens a new Terminal.app window via `osascript` and runs the given command
 * inside it. Supports bringing the terminal to the foreground.
 *
 * Ported from ufoo's adapters/terminalAdapter.js.
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

function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout ?? "").trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class NativeTerminalAdapter implements TerminalAdapter {
  readonly mode: LaunchMode = "terminal";

  readonly capabilities: TerminalCapabilities = {
    supportsActivate: true,
    supportsInjection: false,
    supportsSessionReuse: true,
    supportsResize: false,
  };

  async launch(
    command: string,
    args: string[],
    opts: AdapterLaunchOptions,
  ): Promise<LaunchedProcess> {
    // Build full shell command string (escaped for AppleScript)
    const escaped = [command, ...args]
      .map((a) => a.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "'\\''"))
      .join(" ");

    const cwd = opts.cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "'\\''");

    // Use osascript to open a new Terminal window and run the command
    const script = `
      tell application "Terminal"
        activate
        set newTab to do script "cd '${cwd}' && ${escaped}"
      end tell
    `;

    await osascript(script);

    // Terminal.app does not expose the child PID easily via AppleScript.
    // We fall back to spawning the process ourselves so we can track I/O.
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

    return {
      pid: child.pid ?? 0,
      write(data: string) {
        child.stdin?.write(data);
      },
      resize(_cols: number, _rows: number) {
        // Terminal.app does not support programmatic resize
      },
      kill() {
        child.kill();
      },
      onData(handler: (data: string) => void) {
        dataHandlers.push(handler);
      },
      onExit(handler: (code: number) => void) {
        exitHandlers.push(handler);
      },
    };
  }

  async activate(_processOrId: number | string): Promise<void> {
    await osascript('tell application "Terminal" to activate');
  }
}
