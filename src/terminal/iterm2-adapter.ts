/**
 * iTerm2 adapter.
 *
 * Uses osascript with iTerm2's AppleScript API to create new sessions
 * (tabs / splits) and run commands.  Supports activation (bring to front)
 * and text injection via `write text`.
 *
 * Reference: https://iterm2.com/documentation-scripting.html
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

export class ITerm2Adapter implements TerminalAdapter {
  readonly mode: LaunchMode = "iterm2";

  readonly capabilities: TerminalCapabilities = {
    supportsActivate: true,
    supportsInjection: true,
    supportsSessionReuse: true,
    supportsResize: false,
  };

  async launch(
    command: string,
    args: string[],
    opts: AdapterLaunchOptions,
  ): Promise<LaunchedProcess> {
    // Sanitize for AppleScript: escape backslashes, quotes, AND newlines
    // to prevent AppleScript injection via crafted arguments.
    const escapeAS = (s: string): string =>
      s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "").replace(/\r/g, "");

    const escaped = [command, ...args].map(escapeAS).join(" ");
    const cwd = escapeAS(opts.cwd);

    // Create a new iTerm2 tab and run the command there.
    const script = `
      tell application "iTerm2"
        activate
        tell current window
          set newTab to (create tab with default profile)
          tell current session of newTab
            write text "cd \\"${cwd}\\" && ${escaped}"
          end tell
        end tell
      end tell
    `;

    await osascript(script);

    // Spawn a local child process for lifecycle tracking, same pattern as
    // NativeTerminalAdapter.
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...(opts.env ?? {}),
        // Preserve iTerm2 session id so child processes can detect the terminal
        ITERM_SESSION_ID: process.env.ITERM_SESSION_ID ?? "",
        TERM_PROGRAM: process.env.TERM_PROGRAM ?? "",
        TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION ?? "",
      },
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
        // iTerm2 resize via AppleScript is unreliable; no-op for now
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

  async inject(processOrId: number | string, command: string): Promise<void> {
    const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "").replace(/\r/g, "");
    // Write text to the current iTerm2 session
    const script = `
      tell application "iTerm2"
        tell current session of current window
          write text "${escaped}"
        end tell
      end tell
    `;
    await osascript(script);
    void processOrId;
  }

  async activate(_processOrId: number | string): Promise<void> {
    await osascript('tell application "iTerm2" to activate');
  }
}
