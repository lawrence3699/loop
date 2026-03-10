/**
 * AgentLauncher — unified agent lifecycle manager.
 *
 * Handles:
 *   1. Ensuring the .loop/ project directory exists
 *   2. Detecting (or using specified) launch mode
 *   3. Spawning a PtySession via the appropriate terminal adapter
 *   4. Setting up ReadyDetector + ActivityDetector
 *   5. Registering with the daemon via IPC (fail-silently if no daemon)
 *   6. SIGTERM / SIGINT cleanup
 *
 * Simplified port of ufoo's launcher.js.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PtySession } from "./pty-session.js";
import { ActivityDetector } from "./activity.js";
import { ReadyDetector } from "./ready-detector.js";
import { detectTerminal, type LaunchMode } from "../terminal/detect.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  agentType: string;
  command: string;
  args: string[];
  cwd: string;
  launchMode?: LaunchMode;
  nickname?: string;
  env?: Record<string, string>;
}

export interface LaunchedAgent {
  subscriberId: string;
  ptySession: PtySession;
  activityDetector: ActivityDetector;
  readyDetector: ReadyDetector;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loopDir(projectRoot: string): string {
  return path.join(projectRoot, ".loop");
}

function runDir(projectRoot: string): string {
  return path.join(loopDir(projectRoot), "run");
}

function daemonSocketPath(projectRoot: string): string {
  return path.join(runDir(projectRoot), "daemon.sock");
}

function connectSocket(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath, () => resolve(client));
    client.on("error", reject);
  });
}

async function connectWithRetry(
  sockPath: string,
  retries: number,
  delayMs: number,
): Promise<net.Socket | null> {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await connectSocket(sockPath);
    } catch {
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

/**
 * Best-effort daemon registration.  Returns the subscriber ID from the
 * daemon or a locally-generated one if the daemon is unreachable.
 */
async function registerWithDaemon(
  projectRoot: string,
  agentType: string,
  subscriberId: string,
  nickname: string,
): Promise<string> {
  const sockPath = daemonSocketPath(projectRoot);
  const client = await connectWithRetry(sockPath, 3, 200);
  if (!client) return subscriberId; // daemon not running — proceed anyway

  return new Promise<string>((resolve) => {
    let buffer = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { client.destroy(); } catch { /* ignore */ }
      resolve(subscriberId); // fall back to local ID
    }, 5_000);

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeAllListeners();
      try { client.end(); } catch { /* ignore */ }
    };

    client.on("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(subscriberId);
    });

    client.on("data", (data) => {
      buffer += data.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (payload.type === "register_ok" && typeof payload.subscriberId === "string") {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(payload.subscriberId);
          return;
        }
        if (payload.type === "error") {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(subscriberId); // fall back
          return;
        }
      }
    });

    const req = {
      type: "register_agent",
      agentType,
      nickname,
      parentPid: process.pid,
    };
    client.write(JSON.stringify(req) + "\n");
  });
}

// ---------------------------------------------------------------------------
// AgentLauncher
// ---------------------------------------------------------------------------

export class AgentLauncher {
  private readonly _projectRoot: string;

  constructor(projectRoot: string) {
    this._projectRoot = projectRoot;
  }

  /**
   * Launch an agent, returning a handle with the PtySession and detectors.
   */
  async launch(opts: LaunchOptions): Promise<LaunchedAgent> {
    // 1. Ensure .loop/ directory structure
    const loopRoot = loopDir(this._projectRoot);
    const run = runDir(this._projectRoot);
    for (const dir of [loopRoot, run]) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // May already exist
      }
    }

    // 2. Resolve launch mode
    const mode = opts.launchMode ?? detectTerminal();

    // 3. Generate subscriber ID
    const sessionId = randomUUID().slice(0, 8);
    const localSubscriberId = `${opts.agentType}:${sessionId}`;

    // 4. Set environment variables for child process
    const childEnv: Record<string, string> = {
      ...(opts.env ?? {}),
      LOOP_SUBSCRIBER_ID: localSubscriberId,
      LOOP_AGENT_TYPE: opts.agentType,
      LOOP_LAUNCH_MODE: mode,
    };
    if (opts.nickname) {
      childEnv.LOOP_NICKNAME = opts.nickname;
    }

    // 5. Create PtySession
    const ptySession = new PtySession(opts.command, opts.args, {
      cwd: opts.cwd,
      env: childEnv,
      engine: opts.agentType,
    });

    // 6. Enable I/O logging
    ptySession.enableLogging(run);

    // 7. Enable inject socket
    const injectSocketDir = path.join(loopRoot, "sockets");
    const sanitizedId = localSubscriberId.replace(/:/g, "_");
    const injectSockPath = path.join(injectSocketDir, `${sanitizedId}.sock`);
    ptySession.enableInjectSocket(injectSockPath);

    // 8. Set up detectors
    const readyDetector = new ReadyDetector(ptySession);
    const activityDetector = new ActivityDetector(ptySession, opts.agentType);

    // Force-ready fallback after 10 seconds
    const forceReadyTimer = setTimeout(() => {
      readyDetector.forceReady();
    }, 10_000);
    if (typeof forceReadyTimer.unref === "function") {
      forceReadyTimer.unref();
    }

    // 9. Register with daemon (best-effort, non-blocking)
    const subscriberId = await registerWithDaemon(
      this._projectRoot,
      opts.agentType,
      localSubscriberId,
      opts.nickname ?? "",
    );

    // 10. Notify daemon when ready
    readyDetector.onReady(() => {
      clearTimeout(forceReadyTimer);
      const sockPath = daemonSocketPath(this._projectRoot);
      connectWithRetry(sockPath, 2, 100).then((client) => {
        if (!client) return;
        client.write(
          JSON.stringify({
            type: "agent_ready",
            subscriberId,
          }) + "\n",
        );
        client.end();
      }).catch(() => {
        // Daemon notification failure is non-fatal
      });
    });

    // 11. Build cleanup function
    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(forceReadyTimer);
      activityDetector.destroy();
      readyDetector.destroy();
      ptySession.destroy();
    };

    // 12. Signal handlers (stored for cleanup to prevent accumulation)
    let signalHandled = false;
    const handleSignal = (signal: string) => {
      if (signalHandled) return;
      signalHandled = true;
      const code = signal === "SIGTERM" ? 143 : 130;
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      cleanup().finally(() => process.exit(code));
    };
    const onSigterm = () => handleSignal("SIGTERM");
    const onSigint = () => handleSignal("SIGINT");
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);

    return {
      subscriberId,
      ptySession,
      activityDetector,
      readyDetector,
      cleanup,
    };
  }
}
