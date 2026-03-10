import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus } from "../../../src/bus/event-bus.js";

// Mock isProcessAlive for subscriber cleanup
vi.mock("../../../src/utils/process.js", () => ({
  isProcessAlive: vi.fn(() => true),
}));

describe("EventBus", () => {
  let tmpDir: string;
  let bus: EventBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-bus-test-"));
    bus = new EventBus(tmpDir);
    await bus.init();
  });

  afterEach(async () => {
    await bus.shutdown();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── init ───────────────────────────────────────────
  describe("init", () => {
    it("creates directory structure", () => {
      expect(existsSync(join(tmpDir, ".loop", "bus", "events"))).toBe(true);
      expect(existsSync(join(tmpDir, ".loop", "bus", "queues"))).toBe(true);
      expect(existsSync(join(tmpDir, ".loop", "bus", "offsets"))).toBe(true);
      expect(existsSync(join(tmpDir, ".loop", "agents"))).toBe(true);
    });
  });

  // ── join / leave ───────────────────────────────────
  describe("join / leave", () => {
    it("registers an agent and returns subscriber ID", async () => {
      const id = await bus.join("claude");
      expect(id).toMatch(/^claude:[a-f0-9]{8}$/);
    });

    it("leave marks agent as inactive", async () => {
      const id = await bus.join("claude");
      await bus.leave(id);

      const agents = await bus.agents();
      const meta = agents.get(id);
      expect(meta?.status).toBe("inactive");
    });
  });

  // ── send / check / consume ─────────────────────────
  describe("send / check / consume", () => {
    it("sends a targeted message", async () => {
      const id = await bus.join("claude");
      const event = await bus.send("orchestrator", id, "hello claude");

      expect(event.seq).toBeGreaterThan(0);
      expect(event.data.message).toBe("hello claude");
    });

    it("check returns pending messages without consuming", async () => {
      const id = await bus.join("claude");
      await bus.send("orch", id, "msg1");

      const peeked = await bus.check(id);
      expect(peeked).toHaveLength(1);

      // Still there
      const again = await bus.check(id);
      expect(again).toHaveLength(1);
    });

    it("consume returns and clears pending messages", async () => {
      const id = await bus.join("claude");
      await bus.send("orch", id, "msg1");
      await bus.send("orch", id, "msg2");

      const consumed = await bus.consume(id);
      expect(consumed).toHaveLength(2);
      expect(consumed[0].data.message).toBe("msg1");
      expect(consumed[1].data.message).toBe("msg2");

      // Queue should be empty now
      const after = await bus.consume(id);
      expect(after).toHaveLength(0);
    });
  });

  // ── broadcast ──────────────────────────────────────
  describe("broadcast", () => {
    it("sends a message to all active agents", async () => {
      const id1 = await bus.join("claude");
      const id2 = await bus.join("gemini");

      await bus.broadcast("orch", "hello everyone");

      const msgs1 = await bus.check(id1);
      const msgs2 = await bus.check(id2);
      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs1[0].data.message).toBe("hello everyone");
    });
  });

  // ── status ─────────────────────────────────────────
  describe("status", () => {
    it("returns correct agent count", async () => {
      await bus.join("claude");
      await bus.join("gemini");

      const status = await bus.status();
      expect(status.agents).toBe(2);
    });

    it("returns correct event count", async () => {
      const id = await bus.join("claude");
      await bus.send("orch", id, "msg1");
      await bus.send("orch", id, "msg2");

      const status = await bus.status();
      expect(status.events).toBe(2);
    });

    it("includes agent list with details", async () => {
      const id = await bus.join("claude", { nickname: "my-claude" });

      const status = await bus.status();
      expect(status.agentList).toHaveLength(1);
      expect(status.agentList[0].id).toBe(id);
      expect(status.agentList[0].type).toBe("claude");
      expect(status.agentList[0].nickname).toBe("my-claude");
      expect(status.agentList[0].status).toBe("active");
    });
  });

  // ── resolveTarget ──────────────────────────────────
  describe("resolveTarget", () => {
    it("resolves nickname", async () => {
      const id = await bus.join("claude", { nickname: "agent-x" });
      const targets = await bus.resolveTarget("agent-x");
      expect(targets).toEqual([id]);
    });
  });
});
