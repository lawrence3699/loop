import { join } from "node:path";
import { ensureDir, appendJsonl, readJsonl, safeWriteFile, safeReadFile, fileExists } from "../utils/fs.js";
import type { BusEvent } from "./event-bus.js";
import type { AgentMetadata } from "./subscriber.js";

/** Shape of the on-disk agents registry */
interface AgentsData {
  created_at: string;
  agents: Record<string, AgentMetadata>;
}

/**
 * File-backed store for the event bus.
 *
 * Layout under `<project>/.loop/`:
 *   bus/events/{YYYY-MM-DD}.jsonl   - append-only event log
 *   bus/queues/{subscriberId}/
 *     pending.jsonl                 - pending messages per subscriber
 *     tty                           - agent TTY path
 *   bus/offsets/{subscriberId}.offset - consumption offset
 *   bus/seq.counter                 - monotonic sequence number
 *   bus/seq.counter.lock            - file lock for counter
 *   agents/all-agents.json          - agent registry
 */
export class BusStore {
  readonly busDir: string;
  readonly eventsDir: string;
  readonly queuesDir: string;
  readonly offsetsDir: string;
  readonly agentsDir: string;
  readonly agentsFile: string;
  readonly seqCounterPath: string;
  readonly seqLockPath: string;
  readonly runDir: string;

  constructor(busDir: string) {
    this.busDir = busDir;

    // Bus subdirectories live under busDir
    this.eventsDir = join(busDir, "events");
    this.queuesDir = join(busDir, "queues");
    this.offsetsDir = join(busDir, "offsets");
    this.seqCounterPath = join(busDir, "seq.counter");
    this.seqLockPath = join(busDir, "seq.counter.lock");

    // Agents directory is a sibling of bus/ under .loop/
    const loopDir = join(busDir, "..");
    this.agentsDir = join(loopDir, "agents");
    this.agentsFile = join(this.agentsDir, "all-agents.json");
    this.runDir = join(loopDir, "run");
  }

  /**
   * Ensure all required directories exist.
   */
  async init(): Promise<void> {
    await Promise.all([
      ensureDir(this.eventsDir),
      ensureDir(this.queuesDir),
      ensureDir(this.offsetsDir),
      ensureDir(this.agentsDir),
      ensureDir(this.runDir),
    ]);

    // Create the agents file if it doesn't exist
    if (!(await fileExists(this.agentsFile))) {
      const initial: AgentsData = {
        created_at: new Date().toISOString(),
        agents: {},
      };
      await safeWriteFile(this.agentsFile, JSON.stringify(initial, null, 2) + "\n");
    }
  }

  /**
   * Append an event to the daily event log.
   */
  async appendEvent(event: BusEvent): Promise<void> {
    const date = event.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.eventsDir, `${date}.jsonl`);
    await appendJsonl(filePath, event);
  }

  /**
   * Append an event to a subscriber's pending queue.
   */
  async appendToQueue(subscriberId: string, event: BusEvent): Promise<void> {
    const safeName = subscriberToSafeName(subscriberId);
    const queueDir = join(this.queuesDir, safeName);
    await ensureDir(queueDir);
    const pendingPath = join(queueDir, "pending.jsonl");
    await appendJsonl(pendingPath, event);
  }

  /**
   * Read and clear a subscriber's pending queue (atomic drain).
   */
  async consumeQueue(subscriberId: string): Promise<BusEvent[]> {
    const safeName = subscriberToSafeName(subscriberId);
    const pendingPath = join(this.queuesDir, safeName, "pending.jsonl");
    const events = await readJsonl<BusEvent>(pendingPath);
    if (events.length > 0) {
      // Truncate the file after reading
      await safeWriteFile(pendingPath, "");
    }
    return events;
  }

  /**
   * Read a subscriber's pending queue without clearing it.
   */
  async peekQueue(subscriberId: string): Promise<BusEvent[]> {
    const safeName = subscriberToSafeName(subscriberId);
    const pendingPath = join(this.queuesDir, safeName, "pending.jsonl");
    return readJsonl<BusEvent>(pendingPath);
  }

  /**
   * Get a subscriber's consumption offset.
   */
  async getOffset(subscriberId: string): Promise<number> {
    const safeName = subscriberToSafeName(subscriberId);
    const offsetPath = join(this.offsetsDir, `${safeName}.offset`);
    const content = await safeReadFile(offsetPath);
    if (content === null) return 0;
    const parsed = parseInt(content.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * Set a subscriber's consumption offset.
   */
  async setOffset(subscriberId: string, seq: number): Promise<void> {
    const safeName = subscriberToSafeName(subscriberId);
    const offsetPath = join(this.offsetsDir, `${safeName}.offset`);
    await ensureDir(this.offsetsDir);
    await safeWriteFile(offsetPath, `${seq}\n`);
  }

  /**
   * Load the agents registry.
   */
  async loadAgents(): Promise<Map<string, AgentMetadata>> {
    const content = await safeReadFile(this.agentsFile);
    if (content === null) return new Map();

    try {
      const data = JSON.parse(content) as AgentsData;
      const agents = data.agents ?? {};
      return new Map(Object.entries(agents));
    } catch {
      return new Map();
    }
  }

  /**
   * Save the agents registry.
   */
  async saveAgents(agents: Map<string, AgentMetadata>): Promise<void> {
    const existing = await safeReadFile(this.agentsFile);
    let data: AgentsData;
    try {
      data = existing ? (JSON.parse(existing) as AgentsData) : { created_at: new Date().toISOString(), agents: {} };
    } catch {
      data = { created_at: new Date().toISOString(), agents: {} };
    }

    data.agents = Object.fromEntries(agents);
    await safeWriteFile(this.agentsFile, JSON.stringify(data, null, 2) + "\n");
  }

  /**
   * Count total events across all event log files.
   */
  async countEvents(): Promise<number> {
    const { readdir, readFile } = await import("node:fs/promises");
    let total = 0;
    try {
      const files = await readdir(this.eventsDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const content = await readFile(join(this.eventsDir, file), "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        total += lines.length;
      }
    } catch {
      // Events dir may not exist yet
    }
    return total;
  }

  /**
   * Ensure a subscriber's queue directory exists.
   */
  async ensureQueue(subscriberId: string): Promise<void> {
    const safeName = subscriberToSafeName(subscriberId);
    await ensureDir(join(this.queuesDir, safeName));
  }
}

/**
 * Convert a subscriber ID to a safe directory name.
 * Replaces ":" with "_" so it can be used in file paths.
 */
export function subscriberToSafeName(subscriberId: string): string {
  // Strip path separators and traversal sequences to prevent directory escape
  return subscriberId.replace(/:/g, "_").replace(/[/\\]/g, "").replace(/\.\./g, "");
}

/**
 * Convert a safe directory name back to a subscriber ID.
 * Replaces the first "_" with ":" to reconstruct the original format.
 */
export function safeNameToSubscriber(safeName: string): string {
  const idx = safeName.indexOf("_");
  if (idx === -1) return safeName;
  return safeName.slice(0, idx) + ":" + safeName.slice(idx + 1);
}
