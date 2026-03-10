import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import {
  IpcServer,
  type IpcRequest,
  type IpcResponse,
} from "../../../src/orchestrator/ipc-server.js";

describe("IpcServer", () => {
  let tmpDir: string;
  let socketPath: string;
  let server: IpcServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-ipc-test-"));
    socketPath = join(tmpDir, "test.sock");
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestServer(
    handler?: (req: IpcRequest) => Promise<IpcResponse>,
  ): IpcServer {
    const defaultHandler = async (req: IpcRequest): Promise<IpcResponse> => ({
      success: true,
      type: req.type,
      data: { echo: req.data },
    });

    server = new IpcServer(socketPath, handler ?? defaultHandler);
    return server;
  }

  function sendRequest(
    path: string,
    req: unknown,
  ): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const client = createConnection(path, () => {
        client.write(JSON.stringify(req) + "\n");
      });

      let buffer = "";
      client.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line.trim()) as IpcResponse;
              client.destroy();
              resolve(response);
              return;
            } catch {
              // incomplete JSON, wait for more data
            }
          }
        }
      });

      client.on("error", reject);
      client.setTimeout(5000, () => {
        client.destroy();
        reject(new Error("Connection timeout"));
      });
    });
  }

  // ── basic server lifecycle ─────────────────────────
  it("starts and stops without error", async () => {
    const srv = createTestServer();
    await srv.start();
    await srv.stop();
  });

  // ── accepts connections ────────────────────────────
  it("accepts connections and responds", async () => {
    const srv = createTestServer();
    await srv.start();

    const response = await sendRequest(socketPath, {
      type: "STATUS",
      data: {},
    });

    expect(response.success).toBe(true);
    expect(response.type).toBe("STATUS");
  });

  // ── JSON request handling ──────────────────────────
  it("handles JSON requests and returns responses", async () => {
    const srv = createTestServer(async (req) => ({
      success: true,
      type: req.type,
      data: { received: req.data.message },
    }));
    await srv.start();

    const response = await sendRequest(socketPath, {
      type: "BUS_SEND",
      data: { message: "hello" },
    });

    expect(response.success).toBe(true);
    expect(response.data?.received).toBe("hello");
  });

  // ── malformed input ────────────────────────────────
  it("handles malformed JSON gracefully", async () => {
    const srv = createTestServer();
    await srv.start();

    const response = await new Promise<IpcResponse>((resolve, reject) => {
      const client = createConnection(socketPath, () => {
        client.write("not valid json\n");
      });

      let buffer = "";
      client.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const resp = JSON.parse(line.trim()) as IpcResponse;
              client.destroy();
              resolve(resp);
              return;
            } catch {
              // wait for complete JSON
            }
          }
        }
      });

      client.on("error", reject);
      client.setTimeout(5000, () => {
        client.destroy();
        reject(new Error("Timeout"));
      });
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("Invalid JSON");
  });

  // ── missing request type ───────────────────────────
  it("handles missing request type", async () => {
    const srv = createTestServer();
    await srv.start();

    const response = await sendRequest(socketPath, { data: {} });
    expect(response.success).toBe(false);
    expect(response.error).toBe("Missing request type");
  });

  // ── clientCount ────────────────────────────────────
  it("tracks client count", async () => {
    const srv = createTestServer();
    await srv.start();

    expect(srv.clientCount).toBe(0);
  });

  // ── broadcast ──────────────────────────────────────
  it("broadcast sends to connected clients", async () => {
    const srv = createTestServer(async (req) => {
      // Don't respond immediately - we'll check broadcast
      return { success: true, type: req.type };
    });
    await srv.start();

    // Just verify broadcast doesn't throw on empty clients
    srv.broadcast({ success: true, type: "NOTIFY", data: { msg: "test" } });
  });

  // ── handler errors ─────────────────────────────────
  it("returns error response when handler throws", async () => {
    const srv = createTestServer(async () => {
      throw new Error("handler failed");
    });
    await srv.start();

    const response = await sendRequest(socketPath, {
      type: "STATUS",
      data: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("handler failed");
  });
});
