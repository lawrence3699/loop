import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SubscriberManager } from "../../../src/bus/subscriber.js";
import { BusStore } from "../../../src/bus/store.js";

// Mock isProcessAlive
vi.mock("../../../src/utils/process.js", () => ({
  isProcessAlive: vi.fn((pid: number) => {
    // By default, return false (process dead) for test PIDs
    // Return true for the current process PID
    return pid === process.pid;
  }),
}));

describe("SubscriberManager", () => {
  let tmpDir: string;
  let store: BusStore;
  let manager: SubscriberManager;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-subscriber-test-"));
    const busDir = join(tmpDir, ".loop", "bus");
    store = new BusStore(busDir);
    await store.init();
    manager = new SubscriberManager(store);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── register ───────────────────────────────────────
  describe("register", () => {
    it("creates subscriberId in {agentType}:{hex} format", async () => {
      const id = await manager.register("claude");
      expect(id).toMatch(/^claude:[a-f0-9]{8}$/);
    });

    it("assigns a generated nickname", async () => {
      const id = await manager.register("claude");
      const meta = await manager.get(id);
      expect(meta?.nickname).toBe("claude-1");
    });

    it("generates unique IDs for multiple registrations", async () => {
      const id1 = await manager.register("claude");
      const id2 = await manager.register("claude");
      expect(id1).not.toBe(id2);
    });

    it("increments nickname index for same agent type", async () => {
      const id1 = await manager.register("claude");
      const id2 = await manager.register("claude");
      const meta1 = await manager.get(id1);
      const meta2 = await manager.get(id2);
      expect(meta1?.nickname).toBe("claude-1");
      expect(meta2?.nickname).toBe("claude-2");
    });

    it("uses provided nickname when specified", async () => {
      const id = await manager.register("claude", { nickname: "my-agent" });
      const meta = await manager.get(id);
      expect(meta?.nickname).toBe("my-agent");
    });

    it("sets status to active", async () => {
      const id = await manager.register("claude");
      const meta = await manager.get(id);
      expect(meta?.status).toBe("active");
    });

    it("stores agent_type correctly", async () => {
      const id = await manager.register("gemini");
      const meta = await manager.get(id);
      expect(meta?.agent_type).toBe("gemini");
    });
  });

  // ── unregister ─────────────────────────────────────
  describe("unregister", () => {
    it("marks subscriber as inactive", async () => {
      const id = await manager.register("claude");
      await manager.unregister(id);

      const meta = await manager.get(id);
      expect(meta?.status).toBe("inactive");
    });

    it("does not throw for unknown subscriberId", async () => {
      await expect(manager.unregister("unknown:id")).resolves.not.toThrow();
    });
  });

  // ── rename ─────────────────────────────────────────
  describe("rename", () => {
    it("updates the nickname", async () => {
      const id = await manager.register("claude");
      await manager.rename(id, "new-name");

      const meta = await manager.get(id);
      expect(meta?.nickname).toBe("new-name");
    });

    it("throws for unknown subscriber", async () => {
      await expect(manager.rename("unknown:id", "name")).rejects.toThrow("not found");
    });

    it("throws on nickname conflict with active agent", async () => {
      const id1 = await manager.register("claude", { nickname: "taken" });
      const id2 = await manager.register("claude");

      // Suppress the expected id1 unused warning
      void id1;

      await expect(manager.rename(id2, "taken")).rejects.toThrow("already in use");
    });
  });

  // ── list ───────────────────────────────────────────
  describe("list", () => {
    it("returns all active subscribers", async () => {
      await manager.register("claude");
      await manager.register("gemini");

      const agents = await manager.list();
      expect(agents.size).toBe(2);
    });

    it("includes inactive subscribers", async () => {
      const id = await manager.register("claude");
      await manager.unregister(id);
      await manager.register("gemini");

      const agents = await manager.list();
      expect(agents.size).toBe(2);
    });
  });

  // ── cleanupInactive ────────────────────────────────
  describe("cleanupInactive", () => {
    it("marks agents with dead PIDs as inactive", async () => {
      // Register agent with a fake PID that isProcessAlive will report as dead
      const id = await manager.register("claude", { pid: 999999 });

      const cleaned = await manager.cleanupInactive();
      expect(cleaned).toContain(id);

      const meta = await manager.get(id);
      expect(meta?.status).toBe("inactive");
    });

    it("keeps agents with alive PIDs (current process)", async () => {
      const id = await manager.register("claude", { pid: process.pid });

      const cleaned = await manager.cleanupInactive();
      expect(cleaned).not.toContain(id);

      const meta = await manager.get(id);
      expect(meta?.status).toBe("active");
    });

    it("returns empty array when nothing to clean", async () => {
      const cleaned = await manager.cleanupInactive();
      expect(cleaned).toEqual([]);
    });
  });

  // ── get ────────────────────────────────────────────
  describe("get", () => {
    it("returns metadata for existing subscriber", async () => {
      const id = await manager.register("claude");
      const meta = await manager.get(id);
      expect(meta).toBeDefined();
      expect(meta?.agent_type).toBe("claude");
    });

    it("returns undefined for non-existent subscriber", async () => {
      const meta = await manager.get("no:such");
      expect(meta).toBeUndefined();
    });
  });
});
