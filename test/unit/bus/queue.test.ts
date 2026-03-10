import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QueueManager } from "../../../src/bus/queue.js";
import type { BusEvent } from "../../../src/bus/event-bus.js";

function makeEvent(seq: number, message: string): BusEvent {
  return {
    seq,
    timestamp: new Date().toISOString(),
    type: "message/targeted",
    event: "message",
    publisher: "test-pub",
    target: "test-target",
    data: { message },
  };
}

describe("QueueManager", () => {
  let tmpDir: string;
  let queue: QueueManager;
  const subscriberId = "claude:test1234";

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-queue-test-"));
    const busDir = join(tmpDir, "bus");
    queue = new QueueManager(busDir);
    await queue.ensureQueue(subscriberId);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── enqueue / dequeue ──────────────────────────────
  describe("enqueue / dequeue", () => {
    it("enqueues and dequeues events", async () => {
      const event = makeEvent(1, "hello");
      await queue.enqueue(subscriberId, event);

      const events = await queue.dequeue(subscriberId);
      expect(events).toHaveLength(1);
      expect(events[0].data.message).toBe("hello");
    });

    it("dequeue clears the pending queue", async () => {
      await queue.enqueue(subscriberId, makeEvent(1, "msg1"));
      await queue.dequeue(subscriberId);

      const events = await queue.dequeue(subscriberId);
      expect(events).toHaveLength(0);
    });

    it("maintains FIFO ordering", async () => {
      await queue.enqueue(subscriberId, makeEvent(1, "first"));
      await queue.enqueue(subscriberId, makeEvent(2, "second"));
      await queue.enqueue(subscriberId, makeEvent(3, "third"));

      const events = await queue.dequeue(subscriberId);
      expect(events).toHaveLength(3);
      expect(events[0].data.message).toBe("first");
      expect(events[1].data.message).toBe("second");
      expect(events[2].data.message).toBe("third");
    });
  });

  // ── peek ───────────────────────────────────────────
  describe("peek", () => {
    it("returns pending events without clearing", async () => {
      await queue.enqueue(subscriberId, makeEvent(1, "peeked"));

      const peeked = await queue.peek(subscriberId);
      expect(peeked).toHaveLength(1);

      // Still there after peek
      const again = await queue.peek(subscriberId);
      expect(again).toHaveLength(1);
    });

    it("returns empty array when no pending events", async () => {
      const events = await queue.peek(subscriberId);
      expect(events).toEqual([]);
    });
  });

  // ── clear ──────────────────────────────────────────
  describe("clear", () => {
    it("removes all pending events", async () => {
      await queue.enqueue(subscriberId, makeEvent(1, "a"));
      await queue.enqueue(subscriberId, makeEvent(2, "b"));
      await queue.clear(subscriberId);

      const events = await queue.peek(subscriberId);
      expect(events).toEqual([]);
    });
  });

  // ── ensureQueue ────────────────────────────────────
  describe("ensureQueue", () => {
    it("creates the queue directory", async () => {
      const newId = "gemini:newqueue";
      await queue.ensureQueue(newId);

      const { existsSync } = await import("node:fs");
      const queueDir = queue.getQueueDir(newId);
      expect(existsSync(queueDir)).toBe(true);
    });
  });

  // ── offset tracking ────────────────────────────────
  describe("offset tracking", () => {
    it("returns 0 when no offset set", async () => {
      const offset = await queue.getOffset(subscriberId);
      expect(offset).toBe(0);
    });

    it("stores and retrieves offset", async () => {
      await queue.setOffset(subscriberId, 42);
      const offset = await queue.getOffset(subscriberId);
      expect(offset).toBe(42);
    });
  });

  // ── getPendingPath ─────────────────────────────────
  describe("getPendingPath", () => {
    it("converts subscriber ID to safe path", async () => {
      const path = queue.getPendingPath("claude:abc123");
      expect(path).toContain("claude_abc123");
      expect(path).toContain("pending.jsonl");
    });
  });
});
