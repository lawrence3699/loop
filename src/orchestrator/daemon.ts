import { join } from "node:path";
import { EventBus } from "../bus/event-bus.js";
import { BusDaemon } from "../bus/daemon.js";
import { IpcServer, type IpcRequest, type IpcResponse } from "./ipc-server.js";
import {
  isProcessAlive,
  writePidFile,
  readPidFile,
  removePidFile,
  setupSignalHandlers,
} from "../utils/process.js";
import { ensureDir } from "../utils/fs.js";

/**
 * Status information for the orchestrator daemon.
 */
export interface DaemonStatus {
  pid: number;
  uptime: number;
  agents: number;
  busEvents: number;
}

/**
 * The OrchestratorDaemon manages the lifecycle of:
 *   - EventBus (message routing)
 *   - BusDaemon (queue polling / delivery)
 *   - IpcServer (Unix socket for commands)
 *
 * It persists a PID file and logs to the run directory.
 */
export class OrchestratorDaemon {
  readonly projectRoot: string;

  private readonly loopDir: string;
  private readonly runDir: string;
  private readonly pidPath: string;
  private readonly logPath: string;
  private readonly socketPath: string;

  private eventBus: EventBus;
  private busDaemon: BusDaemon | null = null;
  private ipcServer: IpcServer | null = null;
  private startTime: number = 0;
  private running = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.loopDir = join(projectRoot, ".loop");
    this.runDir = join(this.loopDir, "run");
    this.pidPath = join(this.runDir, "loop-daemon.pid");
    this.logPath = join(this.runDir, "loop-daemon.log");
    this.socketPath = join(this.runDir, "loop.sock");

    this.eventBus = new EventBus(projectRoot);
  }

  /**
   * Start the daemon. Initializes bus, starts polling, opens IPC socket.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Ensure run directory exists
    await ensureDir(this.runDir);

    // Check if another daemon is already running
    const existingPid = readPidFile(this.pidPath);
    if (existingPid !== null && isProcessAlive(existingPid)) {
      throw new Error(`Daemon already running (pid=${existingPid})`);
    }

    // Initialize the event bus
    await this.eventBus.init();

    // Write PID file
    writePidFile(this.pidPath);
    this.startTime = Date.now();
    this.running = true;

    // Start bus daemon
    this.busDaemon = new BusDaemon(this.eventBus, { pollIntervalMs: 1000 });
    await this.busDaemon.start();

    // Start IPC server
    this.ipcServer = new IpcServer(this.socketPath, (req) => this.handleRequest(req));
    await this.ipcServer.start();

    // Set up signal handlers
    setupSignalHandlers(async () => {
      await this.stop();
    });
  }

  /**
   * Stop the daemon gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // Stop IPC server
    if (this.ipcServer) {
      await this.ipcServer.stop();
      this.ipcServer = null;
    }

    // Stop bus daemon
    if (this.busDaemon) {
      await this.busDaemon.stop();
      this.busDaemon = null;
    }

    // Shut down event bus
    await this.eventBus.shutdown();

    // Remove PID file
    removePidFile(this.pidPath);
  }

  /**
   * Ensure the daemon is running. If not, start it.
   */
  async ensureRunning(): Promise<void> {
    if (this.running) return;

    const existingPid = readPidFile(this.pidPath);
    if (existingPid !== null && isProcessAlive(existingPid)) {
      // Another daemon is running, that's fine
      return;
    }

    await this.start();
  }

  /**
   * Check if the daemon is currently running.
   */
  isRunning(): boolean {
    if (this.running) return true;

    // Also check via PID file (might be running in another process)
    const pid = readPidFile(this.pidPath);
    return pid !== null && isProcessAlive(pid);
  }

  /**
   * Get the current daemon status.
   */
  async getStatus(): Promise<DaemonStatus> {
    const busStatus = await this.eventBus.status();

    return {
      pid: process.pid,
      uptime: this.startTime > 0 ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      agents: busStatus.agents,
      busEvents: busStatus.events,
    };
  }

  /**
   * Handle an incoming IPC request.
   */
  async handleRequest(req: IpcRequest): Promise<IpcResponse> {
    // Validate incoming request structure
    if (!req || typeof req !== "object" || typeof req.type !== "string") {
      return { success: false, type: "ERROR", error: "Invalid request: missing type" };
    }
    if (req.data !== undefined && (typeof req.data !== "object" || req.data === null)) {
      return { success: false, type: "ERROR", error: "Invalid request: data must be an object" };
    }
    // Ensure data is always an object for safe property access
    if (!req.data) req.data = {};

    try {
      switch (req.type) {
        case "STATUS": {
          const status = await this.getStatus();
          const busStatus = await this.eventBus.status();
          return {
            success: true,
            type: "STATUS",
            data: {
              ...status,
              agentList: busStatus.agentList,
            },
          };
        }

        case "REGISTER_AGENT": {
          const agentType = String(req.data.agent_type ?? "claude");
          const subscriberId = await this.eventBus.join(agentType, {
            nickname: req.data.nickname as string | undefined,
            pid: req.data.pid as number | undefined,
            tty: req.data.tty as string | undefined,
            launch_mode: req.data.launch_mode as string | undefined,
          });
          return {
            success: true,
            type: "REGISTER_AGENT",
            data: { subscriber_id: subscriberId },
          };
        }

        case "AGENT_READY": {
          const subscriberId = String(req.data.subscriber_id ?? "");
          await this.eventBus.getSubscriberManager().updateMetadata(subscriberId, {
            activity_state: "idle",
            last_seen: new Date().toISOString(),
          });
          return {
            success: true,
            type: "AGENT_READY",
            data: { subscriber_id: subscriberId },
          };
        }

        case "AGENT_REPORT": {
          const subscriberId = String(req.data.subscriber_id ?? "");
          await this.eventBus.getSubscriberManager().updateMetadata(subscriberId, {
            last_seen: new Date().toISOString(),
            activity_state: String(req.data.activity_state ?? "working"),
          });
          return {
            success: true,
            type: "AGENT_REPORT",
            data: { subscriber_id: subscriberId },
          };
        }

        case "BUS_SEND": {
          const publisher = String(req.data.publisher ?? "unknown");
          const target = String(req.data.target ?? "");
          const message = String(req.data.message ?? "");
          const event = await this.eventBus.send(publisher, target, message);
          return {
            success: true,
            type: "BUS_SEND",
            data: { seq: event.seq, target: event.target },
          };
        }

        case "BUS_CHECK": {
          const subscriberId = String(req.data.subscriber_id ?? "");
          const events = await this.eventBus.check(subscriberId);
          return {
            success: true,
            type: "BUS_CHECK",
            data: {
              subscriber_id: subscriberId,
              count: events.length,
              events: events as unknown as Record<string, unknown>[],
            },
          };
        }

        case "LAUNCH_AGENT": {
          // Placeholder - actual agent launching is handled by the agent launcher
          return {
            success: true,
            type: "LAUNCH_AGENT",
            data: { message: "Agent launch request received" },
          };
        }

        case "CLOSE_AGENT": {
          const subscriberId = String(req.data.subscriber_id ?? req.data.agent_id ?? "");
          await this.eventBus.leave(subscriberId);
          return {
            success: true,
            type: "CLOSE_AGENT",
            data: { subscriber_id: subscriberId },
          };
        }

        case "RESUME_AGENTS": {
          return {
            success: true,
            type: "RESUME_AGENTS",
            data: { message: "Resume request received" },
          };
        }

        case "LAUNCH_GROUP": {
          return {
            success: true,
            type: "LAUNCH_GROUP",
            data: { message: "Group launch request received" },
          };
        }

        case "STOP_GROUP": {
          return {
            success: true,
            type: "STOP_GROUP",
            data: { message: "Group stop request received" },
          };
        }

        default: {
          return {
            success: false,
            type: "ERROR",
            error: `Unknown request type: ${req.type}`,
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        type: req.type,
        error: message,
      };
    }
  }

  /**
   * Get the event bus instance.
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get the PID file path (for external tools to check).
   */
  getPidPath(): string {
    return this.pidPath;
  }

  /**
   * Get the socket path (for IPC clients).
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Get the log path.
   */
  getLogPath(): string {
    return this.logPath;
  }
}
