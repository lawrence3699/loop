import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus } from "../../src/bus/event-bus.js";

// Mock isProcessAlive so cleanup doesn't mark our agents inactive
vi.mock("../../src/utils/process.js", () => ({
  isProcessAlive: vi.fn(() => true),
  writePidFile: vi.fn(),
  readPidFile: vi.fn(() => null),
  removePidFile: vi.fn(),
  setupSignalHandlers: vi.fn(),
}));

describe("Bus Delivery (integration)", () => {
  let tmpDir: string;
  let bus: EventBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-bus-integ-"));
    bus = new EventBus(tmpDir);
    await bus.init();
  });

  afterEach(async () => {
    await bus.shutdown();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full event bus lifecycle: join, targeted send, broadcast, leave, cleanup", async () => {
    // --- Join two agents ---
    const agentA = await bus.join("claude", { nickname: "agent-a" });
    const agentB = await bus.join("gemini", { nickname: "agent-b" });

    expect(agentA).toMatch(/^claude:[a-f0-9]{8}$/);
    expect(agentB).toMatch(/^gemini:[a-f0-9]{8}$/);

    // --- Agent-a sends a targeted message to agent-b ---
    const targetedEvent = await bus.send(agentA, agentB, "Hello agent-b, please review this.");

    expect(targetedEvent.seq).toBeGreaterThan(0);
    expect(targetedEvent.type).toBe("message/targeted");
    expect(targetedEvent.publisher).toBe(agentA);
    expect(targetedEvent.target).toBe(agentB);
    expect(targetedEvent.data.message).toBe("Hello agent-b, please review this.");

    // --- Agent-b checks and receives the message ---
    const pending = await bus.check(agentB);
    expect(pending).toHaveLength(1);
    expect(pending[0].data.message).toBe("Hello agent-b, please review this.");
    expect(pending[0].publisher).toBe(agentA);

    // Agent-a should NOT have the targeted message
    const agentAPending = await bus.check(agentA);
    expect(agentAPending).toHaveLength(0);

    // --- Verify JSONL event file was written ---
    const eventsDir = join(tmpDir, ".loop", "bus", "events");
    expect(existsSync(eventsDir)).toBe(true);
    const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    expect(eventFiles.length).toBeGreaterThan(0);

    // Read the JSONL file and verify content
    const eventContent = readFileSync(join(eventsDir, eventFiles[0]), "utf8");
    const eventLines = eventContent.trim().split("\n").filter(Boolean);
    expect(eventLines.length).toBeGreaterThanOrEqual(1);
    const parsedEvent = JSON.parse(eventLines[0]);
    expect(parsedEvent.publisher).toBe(agentA);
    expect(parsedEvent.data.message).toBe("Hello agent-b, please review this.");

    // --- Agent-a broadcasts a message ---
    const broadcastEvent = await bus.broadcast(agentA, "Broadcast: project update");

    expect(broadcastEvent.type).toBe("message/broadcast");
    expect(broadcastEvent.target).toBe("*");

    // --- Both agents receive the broadcast ---
    // Agent-b still has the old targeted message + broadcast
    const agentBMessages = await bus.check(agentB);
    expect(agentBMessages).toHaveLength(2);
    expect(agentBMessages[1].data.message).toBe("Broadcast: project update");

    // Agent-a receives the broadcast
    const agentAMessages = await bus.check(agentA);
    expect(agentAMessages).toHaveLength(1);
    expect(agentAMessages[0].data.message).toBe("Broadcast: project update");

    // --- Consume clears messages ---
    const consumed = await bus.consume(agentB);
    expect(consumed).toHaveLength(2);
    const afterConsume = await bus.check(agentB);
    expect(afterConsume).toHaveLength(0);

    // --- Leave both agents ---
    await bus.leave(agentA);
    await bus.leave(agentB);

    // --- Verify cleanup: agents are marked inactive ---
    const agents = await bus.agents();
    const metaA = agents.get(agentA);
    const metaB = agents.get(agentB);
    expect(metaA?.status).toBe("inactive");
    expect(metaB?.status).toBe("inactive");

    // --- Verify status reflects inactive agents ---
    const status = await bus.status();
    expect(status.agents).toBe(0); // No active agents
    expect(status.events).toBeGreaterThanOrEqual(2); // At least the targeted + broadcast
  });
});
