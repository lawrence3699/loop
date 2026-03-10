import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageManager } from "../../../src/bus/message.js";
import { SubscriberManager } from "../../../src/bus/subscriber.js";
import { BusStore } from "../../../src/bus/store.js";

// Mock isProcessAlive for subscriber cleanup
vi.mock("../../../src/utils/process.js", () => ({
  isProcessAlive: vi.fn(() => true),
}));

describe("MessageManager", () => {
  let tmpDir: string;
  let store: BusStore;
  let subscriberManager: SubscriberManager;
  let messageManager: MessageManager;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-message-test-"));
    const busDir = join(tmpDir, ".loop", "bus");
    store = new BusStore(busDir);
    await store.init();
    subscriberManager = new SubscriberManager(store);
    messageManager = new MessageManager(busDir, subscriberManager);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── nextSeq ────────────────────────────────────────
  describe("nextSeq", () => {
    it("returns monotonically increasing numbers", async () => {
      const seq1 = await messageManager.nextSeq();
      const seq2 = await messageManager.nextSeq();
      const seq3 = await messageManager.nextSeq();

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });
  });

  // ── resolveTarget ──────────────────────────────────
  describe("resolveTarget", () => {
    it("resolves exact subscriber ID match", async () => {
      const id = await subscriberManager.register("claude");
      const targets = await messageManager.resolveTarget(id);
      expect(targets).toEqual([id]);
    });

    it("resolves nickname match", async () => {
      const id = await subscriberManager.register("claude", { nickname: "my-claude" });
      const targets = await messageManager.resolveTarget("my-claude");
      expect(targets).toEqual([id]);
    });

    it("resolves agent type match (returns all active of that type)", async () => {
      const id1 = await subscriberManager.register("claude");
      const id2 = await subscriberManager.register("claude");
      await subscriberManager.register("gemini");

      const targets = await messageManager.resolveTarget("claude");
      expect(targets).toHaveLength(2);
      expect(targets).toContain(id1);
      expect(targets).toContain(id2);
    });

    it("resolves broadcast '*' to all active agents", async () => {
      const id1 = await subscriberManager.register("claude");
      const id2 = await subscriberManager.register("gemini");

      const targets = await messageManager.resolveTarget("*");
      expect(targets).toHaveLength(2);
      expect(targets).toContain(id1);
      expect(targets).toContain(id2);
    });

    it("broadcast excludes inactive agents", async () => {
      const id1 = await subscriberManager.register("claude");
      const id2 = await subscriberManager.register("gemini");
      await subscriberManager.unregister(id2);

      const targets = await messageManager.resolveTarget("*");
      expect(targets).toEqual([id1]);
    });

    it("returns empty array for unknown target", async () => {
      const targets = await messageManager.resolveTarget("nonexistent");
      expect(targets).toEqual([]);
    });

    it("treats colon-containing strings as subscriber IDs even if not registered", async () => {
      const targets = await messageManager.resolveTarget("claude:fake123");
      expect(targets).toEqual(["claude:fake123"]);
    });
  });

  // ── createEvent ────────────────────────────────────
  describe("createEvent", () => {
    it("creates and routes an event to the target", async () => {
      const subscriberId = await subscriberManager.register("claude");

      const event = await messageManager.createEvent(
        "orchestrator",
        subscriberId,
        { message: "hello" },
      );

      expect(event.seq).toBeGreaterThan(0);
      expect(event.publisher).toBe("orchestrator");
      expect(event.target).toBe(subscriberId);
      expect(event.data.message).toBe("hello");
    });

    it("throws when target not found", async () => {
      await expect(
        messageManager.createEvent("pub", "unknown", { message: "test" }),
      ).rejects.toThrow('Target "unknown" not found');
    });

    it("sets correct event type", async () => {
      const id = await subscriberManager.register("claude");

      const event = await messageManager.createEvent(
        "pub",
        id,
        { message: "hello" },
        "message/broadcast",
      );
      expect(event.type).toBe("message/broadcast");
    });
  });
});
