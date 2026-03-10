import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Check if a process with the given PID is alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "EPERM") {
      // Process exists but we lack permission to signal it
      return true;
    }
    return false;
  }
}

/**
 * Set up signal handlers for graceful shutdown.
 * The cleanup function is called once on the first signal received.
 */
export function setupSignalHandlers(cleanup: () => Promise<void>): void {
  let cleaning = false;

  const handler = () => {
    if (cleaning) return;
    cleaning = true;
    cleanup().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
  process.on("exit", () => {
    // Synchronous cleanup on exit - best effort
    if (!cleaning) {
      cleaning = true;
      // Can't await here, but we try to be helpful
    }
  });
}

/**
 * Daemonize a script by spawning it detached with stdio redirected to a log file.
 * Returns the PID of the child process.
 */
export function daemonize(script: string, args: string[], logPath: string): number {
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");

  const child = spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: process.cwd(),
  });

  child.unref();
  closeSync(logFd);

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("Failed to spawn daemon process");
  }

  return pid;
}

/**
 * Write the current process PID to a file.
 */
export function writePidFile(pidPath: string): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, `${process.pid}\n`, "utf8");
}

/**
 * Read a PID from a file, returning null if missing or invalid.
 */
export function readPidFile(pidPath: string): number | null {
  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (Number.isFinite(pid) && pid > 0) {
      return pid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove a PID file.
 */
export function removePidFile(pidPath: string): void {
  try {
    unlinkSync(pidPath);
  } catch {
    // Ignore - file may not exist
  }
}

/**
 * Get the absolute path to a script within this package.
 */
export function resolveScript(relativePath: string): string {
  return resolve(relativePath);
}
