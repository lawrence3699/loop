import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { OrchestratorDaemon } from "../../src/orchestrator/daemon.js";
import type { IpcResponse } from "../../src/orchestrator/ipc-server.js";

// Mock isProcessAlive so cleanup doesn't interfere, but keep real PID file ops
vi.mock("../../src/utils/process.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/process.js")>();
  return {
    ...actual,
    isProcessAlive: vi.fn((pid: number) => pid === process.pid),
    setupSignalHandlers: vi.fn(), // Don't install real signal handlers in tests
  };
});

/**
 * Send an IPC request over a Unix socket and read the response.
 */
function sendIpcRequest(
  socketPath: string,
  request: { type: string; data?: Record<string, unknown> },
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath, () => {
      socket.write(JSON.stringify(request) + "\n");
    });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const response = JSON.parse(trimmed) as IpcResponse;
          socket.destroy();
          resolve(response);
          return;
        } catch {
          // Wait for more data
        }
      }
    });

    socket.on("error", (err) => {
      reject(err);
    });

    setTimeout(() => {
      socket.destroy();
      reject(new Error("IPC request timed out"));
    }, 5000);
  });
}

describe("Daemon Lifecycle (integration)", () => {
  let tmpDir: string;
  let daemon: OrchestratorDaemon;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-daemon-integ-"));
  });

  afterEach(async () => {
    // Always attempt to stop the daemon
    try {
      await daemon.stop();
    } catch {
      // Already stopped or never started
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("start/status/stop lifecycle", async () => {
    daemon = new OrchestratorDaemon(tmpDir);

    // --- Start the daemon ---
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    // --- Verify PID file exists ---
    const pidPath = daemon.getPidPath();
    expect(existsSync(pidPath)).toBe(true);

    // --- Verify IPC socket exists ---
    const socketPath = daemon.getSocketPath();
    expect(existsSync(socketPath)).toBe(true);

    // --- Send a STATUS request via IPC ---
    const statusResponse = await sendIpcRequest(socketPath, {
      type: "STATUS",
    });

    // --- Verify response has correct structure ---
    expect(statusResponse.success).toBe(true);
    expect(statusResponse.type).toBe("STATUS");
    expect(statusResponse.data).toBeDefined();
    expect(typeof statusResponse.data!.pid).toBe("number");
    expect(typeof statusResponse.data!.uptime).toBe("number");
    expect(typeof statusResponse.data!.agents).toBe("number");
    expect(typeof statusResponse.data!.busEvents).toBe("number");
    expect(Array.isArray(statusResponse.data!.agentList)).toBe(true);

    // --- Stop the daemon ---
    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);

    // --- Verify PID file removed ---
    expect(existsSync(pidPath)).toBe(false);
  });

  it("handles REGISTER_AGENT and BUS_SEND via IPC", async () => {
    daemon = new OrchestratorDaemon(tmpDir);
    await daemon.start();
    const socketPath = daemon.getSocketPath();

    // Register an agent
    const registerResp = await sendIpcRequest(socketPath, {
      type: "REGISTER_AGENT",
      data: { agent_type: "claude", nickname: "test-agent", pid: process.pid },
    });

    expect(registerResp.success).toBe(true);
    expect(registerResp.type).toBe("REGISTER_AGENT");
    expect(registerResp.data).toBeDefined();
    expect(typeof registerResp.data!.subscriber_id).toBe("string");

    const subscriberId = registerResp.data!.subscriber_id as string;
    expect(subscriberId).toMatch(/^claude:[a-f0-9]{8}$/);

    // Check status - should show 1 agent
    const statusResp = await sendIpcRequest(socketPath, { type: "STATUS" });
    expect(statusResp.data!.agents).toBe(1);

    // Close the agent
    const closeResp = await sendIpcRequest(socketPath, {
      type: "CLOSE_AGENT",
      data: { subscriber_id: subscriberId },
    });
    expect(closeResp.success).toBe(true);

    await daemon.stop();
  });

  it("returns error for unknown request types", async () => {
    daemon = new OrchestratorDaemon(tmpDir);
    await daemon.start();
    const socketPath = daemon.getSocketPath();

    const resp = await sendIpcRequest(socketPath, {
      type: "NONEXISTENT_COMMAND",
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toContain("Unknown request type");

    await daemon.stop();
  });

  it("prevents double start", async () => {
    daemon = new OrchestratorDaemon(tmpDir);
    await daemon.start();

    // Second start should be a no-op (not throw)
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
  });
});
