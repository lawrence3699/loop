/**
 * PtySession — merged PTY session manager.
 *
 * Combines iterloop's EventEmitter-based PtySession (content/status/idle
 * classification, ring-buffer prompt detection, transcript management) with
 * ufoo's PtyWrapper features (JSONL I/O logging, inject socket, monitoring).
 *
 * Events emitted:
 *   "pty-data"  (data: string)   — raw PTY output
 *   "content"   (line: string)   — meaningful text after classification
 *   "status"    (text: string)   — status update (thinking, etc.)
 *   "idle"      ()               — prompt detected, CLI ready for input
 *   "exit"      (code: number)   — PTY process exited
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import pty from "node-pty";
import { stripAnsi } from "../utils/ansi.js";
import { classifyLine } from "../utils/pty-filter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ring-buffer size for prompt detection (last N chars of clean output). */
const RING_BUFFER_SIZE = 256;

/** Maximum transcript size — roughly 50 KB. */
const MAX_TRANSCRIPT_BYTES = 50 * 1024;

/** Default prompt pattern shared by all supported engines. */
const DEFAULT_PROMPT_PATTERN = /(?:^|\n)[>❯]\s*$/;

// Inject-socket message types (mirrors ufoo's ptySocketContract)
const SOCKET_MSG = {
  OUTPUT: "output",
  REPLAY: "replay",
  SUBSCRIBED: "subscribed",
  SUBSCRIBE: "subscribe",
  RAW: "raw",
  RESIZE: "resize",
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PtySessionOptions {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Engine name used by the output classifier (e.g. "claude", "gemini"). */
  engine?: string;
}

// ---------------------------------------------------------------------------
// PtySession
// ---------------------------------------------------------------------------

export class PtySession extends EventEmitter {
  // -- PTY process ----------------------------------------------------------
  private readonly _pty: ReturnType<typeof pty.spawn>;
  private _alive = true;
  private _lastExitCode: number = 0;

  // -- Output classification ------------------------------------------------
  private readonly _engine: string | undefined;
  private readonly _promptPattern: RegExp;

  // Ring buffer for prompt detection (last RING_BUFFER_SIZE chars of clean text)
  private _ringBuffer = "";

  // Line-level parsing state
  private _currentLine = "";
  private _lastEmittedStatus = "";
  private _lastEmittedContent = "";

  // Transcript (accumulated meaningful content lines)
  private _contentLines: string[] = [];
  private _contentBytes = 0;

  // -- JSONL logger (optional, enabled via enableLogging) -------------------
  private _logger: fs.WriteStream | null = null;
  private _loggerBroken = false;

  // -- Inject socket (optional, enabled via enableInjectSocket) -------------
  private _injectServer: net.Server | null = null;
  private _injectSocketPath: string | null = null;
  private _outputSubscribers = new Set<net.Socket>();
  private _outputRingBuffer = "";
  private readonly OUTPUT_RING_MAX = 256 * 1024; // 256 KB

  // ========================================================================
  // Constructor
  // ========================================================================

  constructor(command: string, args: string[], opts?: PtySessionOptions) {
    super();

    const cwd = opts?.cwd ?? process.cwd();
    const cols = opts?.cols ?? process.stdout.columns ?? 80;
    const rows = opts?.rows ?? process.stdout.rows ?? 24;
    this._engine = opts?.engine;
    this._promptPattern = DEFAULT_PROMPT_PATTERN;

    this._pty = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, ...(opts?.env ?? {}) },
    });

    // ── PTY data handler ──────────────────────────────────────────────
    this._pty.onData((data: string) => {
      if (!this._alive) return;

      const cleaned = stripAnsi(data);

      // Update ring buffer for prompt detection
      this._ringBuffer += cleaned;
      if (this._ringBuffer.length > RING_BUFFER_SIZE) {
        this._ringBuffer = this._ringBuffer.slice(-RING_BUFFER_SIZE);
      }

      // Emit raw PTY data
      this.emit("pty-data", data);

      // Forward to output subscribers (inject socket)
      this._forwardToSubscribers(data);

      // Log output
      this._logEntry("out", data);

      // Classify lines
      this._processCleanChunk(cleaned);

      // Prompt detection → emit idle
      if (this._promptPattern.test(this._ringBuffer)) {
        this.emit("idle");
      }
    });

    // ── PTY exit handler ──────────────────────────────────────────────
    this._pty.onExit(({ exitCode }: { exitCode: number }) => {
      this._alive = false;
      this._lastExitCode = exitCode;
      this.emit("exit", exitCode);
    });
  }

  // ========================================================================
  // Core operations
  // ========================================================================

  write(data: string): void {
    if (!this._alive) return;
    try {
      this._pty.write(data);
      this._logEntry("in", data, "terminal");
    } catch {
      // Process may have exited between alive-check and write
    }
  }

  resize(cols: number, rows: number): void {
    if (!this._alive) return;
    try {
      this._pty.resize(cols, rows);
    } catch {
      // Process may have exited
    }
  }

  kill(): void {
    if (!this._alive) return;
    this._alive = false;
    try {
      this._pty.kill();
    } catch {
      // Already dead
    }
  }

  /**
   * Full cleanup — kills the process, closes logger, tears down inject socket.
   * Safe to call multiple times.
   */
  destroy(): void {
    this.kill();
    this._closeLogger();
    this._closeInjectSocket();
    this.removeAllListeners();
  }

  // ========================================================================
  // State accessors
  // ========================================================================

  get pid(): number {
    return this._pty.pid;
  }

  get isAlive(): boolean {
    return this._alive;
  }

  /** The exit code of the PTY process (0 if still alive). */
  get exitCode(): number {
    return this._lastExitCode;
  }

  /**
   * Write data followed by a carriage return (convenience for sending commands).
   */
  sendLine(line: string): void {
    this.write(line + "\r");
  }

  /**
   * Alias for getTranscript() — returns filtered meaningful content.
   */
  getCleanOutput(): string {
    return this.getTranscript();
  }

  /**
   * Return accumulated meaningful content, capped at ~50 KB.
   */
  getTranscript(): string {
    let result = this._contentLines.join("\n").trim();
    if (Buffer.byteLength(result) > MAX_TRANSCRIPT_BYTES) {
      const buf = Buffer.from(result);
      result = buf.subarray(buf.length - MAX_TRANSCRIPT_BYTES).toString("utf-8");
      const firstNewline = result.indexOf("\n");
      if (firstNewline > 0) {
        result = result.slice(firstNewline + 1);
      }
    }
    return result;
  }

  // ========================================================================
  // Optional features — JSONL logging (from ufoo PtyWrapper)
  // ========================================================================

  /**
   * Enable JSONL I/O logging to the given directory.
   * Creates a timestamped `.jsonl` log file.
   */
  enableLogging(logDir: string): void {
    if (this._logger) return;
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
    const logFile = path.join(logDir, `pty-${this.pid}-${Date.now()}.jsonl`);
    this._logger = fs.createWriteStream(logFile, { flags: "a" });
    this._loggerBroken = false;
    this._logger.on("error", () => {
      this._loggerBroken = true;
    });
  }

  // ========================================================================
  // Optional features — inject socket (from ufoo launcher)
  // ========================================================================

  /**
   * Start a Unix-domain socket server at `socketPath` that accepts
   * JSON-line commands: inject, raw write, resize, subscribe.
   */
  enableInjectSocket(socketPath: string): void {
    if (this._injectServer) return;

    this._injectSocketPath = socketPath;

    // Ensure parent directory exists
    const dir = path.dirname(socketPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // May already exist
    }
    // Remove stale socket file
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    } catch {
      // Ignore
    }

    this._injectServer = net.createServer((client) => {
      let buffer = "";
      client.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const req = JSON.parse(line) as Record<string, unknown>;
            this._handleInjectRequest(req, client);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "parse error";
            client.write(JSON.stringify({ ok: false, error: msg }) + "\n");
          }
        }
      });

      client.on("error", () => {
        this._outputSubscribers.delete(client);
      });
      client.on("close", () => {
        this._outputSubscribers.delete(client);
      });
    });

    this._injectServer.listen(socketPath);
    this._injectServer.on("error", () => {
      // Non-fatal — inject socket is optional
    });
  }

  // ========================================================================
  // Private — output classification (from iterloop PtySession)
  // ========================================================================

  /**
   * Process a chunk of ANSI-stripped text, splitting into lines and
   * classifying each as content / status / ignore.
   */
  private _processCleanChunk(cleaned: string): void {
    for (const ch of cleaned) {
      if (ch === "\n" || ch === "\r") {
        if (this._currentLine.trim()) {
          const kind = classifyLine(this._currentLine, this._engine);
          if (kind === "content") {
            const contentText = this._cleanContentLine(this._currentLine);
            if (contentText) {
              // Deduplicate (TUI re-renders can duplicate content)
              const norm = contentText.replace(/\s+/g, "");
              const lastNorm = this._lastEmittedContent.replace(/\s+/g, "");
              if (norm !== lastNorm) {
                this._lastEmittedContent = contentText;
                this._contentLines.push(contentText);
                this._contentBytes += Buffer.byteLength(contentText);
                while (this._contentBytes > MAX_TRANSCRIPT_BYTES && this._contentLines.length > 1) {
                  const dropped = this._contentLines.shift()!;
                  this._contentBytes -= Buffer.byteLength(dropped);
                }
                this.emit("content", contentText);
              }
            }
          } else if (kind === "status") {
            const statusText = this._extractStatusText(this._currentLine);
            if (statusText && statusText !== this._lastEmittedStatus) {
              this._lastEmittedStatus = statusText;
              this.emit("status", statusText);
            }
          }
          // "ignore" → silently discard
        }
        this._currentLine = "";
      } else {
        this._currentLine += ch;
      }
    }
  }

  /** Strip the ⏺ content marker prefix used by Claude CLI. */
  private _cleanContentLine(line: string): string {
    let text = line.trim();
    if (text.startsWith("⏺")) {
      text = text.slice(1).trimStart();
    }
    return text;
  }

  /** Strip spinner / status prefixes to extract the status message. */
  private _extractStatusText(line: string): string {
    return line
      .trim()
      .replace(/^[\s✳✶✻✽✢·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●]+\s*/, "")
      .trim();
  }

  // ========================================================================
  // Private — JSONL logging
  // ========================================================================

  private _logEntry(dir: "in" | "out", data: string, source?: string): void {
    if (!this._logger || this._loggerBroken) return;
    const entry: Record<string, unknown> = {
      ts: Date.now(),
      dir,
      data: { text: data, encoding: "utf8", size: data.length },
    };
    if (source) entry.source = source;
    try {
      this._logger.write(JSON.stringify(entry) + "\n");
    } catch {
      this._loggerBroken = true;
    }
  }

  private _closeLogger(): void {
    if (!this._logger) return;
    try {
      this._logger.end();
    } catch {
      // Ignore cleanup errors
    }
    this._logger = null;
    this._loggerBroken = false;
  }

  // ========================================================================
  // Private — inject socket helpers
  // ========================================================================

  private _handleInjectRequest(req: Record<string, unknown>, client: net.Socket): void {
    const type = req.type as string | undefined;

    if (type === "inject" && typeof req.command === "string") {
      this.write(req.command);
      // Send CR after a short delay to allow TUI to process
      setTimeout(() => {
        this.write("\r");
      }, 200);
      client.write(JSON.stringify({ ok: true }) + "\n");
      this._logEntry("in", req.command, "inject");
      return;
    }

    if (type === SOCKET_MSG.RAW && typeof req.data === "string") {
      this.write(req.data);
      client.write(JSON.stringify({ ok: true }) + "\n");
      return;
    }

    if (
      type === SOCKET_MSG.RESIZE &&
      typeof req.cols === "number" &&
      typeof req.rows === "number"
    ) {
      this.resize(req.cols, req.rows);
      client.write(JSON.stringify({ ok: true }) + "\n");
      return;
    }

    if (type === SOCKET_MSG.SUBSCRIBE) {
      this._outputSubscribers.add(client);
      client.write(
        JSON.stringify({ type: SOCKET_MSG.SUBSCRIBED, ok: true }) + "\n",
      );
      // Replay buffered output
      if (this._outputRingBuffer.length > 0) {
        client.write(
          JSON.stringify({
            type: SOCKET_MSG.REPLAY,
            data: this._outputRingBuffer,
            encoding: "utf8",
          }) + "\n",
        );
      }
      return;
    }

    client.write(JSON.stringify({ ok: false, error: "unknown request type" }) + "\n");
  }

  private _forwardToSubscribers(data: string): void {
    // Accumulate in ring buffer
    this._outputRingBuffer += data;
    if (this._outputRingBuffer.length > this.OUTPUT_RING_MAX) {
      this._outputRingBuffer = this._outputRingBuffer.slice(-this.OUTPUT_RING_MAX);
    }

    if (this._outputSubscribers.size === 0) return;

    const msg =
      JSON.stringify({
        type: SOCKET_MSG.OUTPUT,
        data,
        encoding: "utf8",
      }) + "\n";

    for (const sub of this._outputSubscribers) {
      try {
        sub.write(msg);
      } catch {
        this._outputSubscribers.delete(sub);
      }
    }
  }

  private _closeInjectSocket(): void {
    // Destroy all subscriber connections
    for (const sub of this._outputSubscribers) {
      try {
        sub.destroy();
      } catch {
        // Ignore
      }
    }
    this._outputSubscribers.clear();

    if (this._injectServer) {
      try {
        this._injectServer.close();
      } catch {
        // Ignore
      }
      this._injectServer = null;
    }

    if (this._injectSocketPath) {
      try {
        if (fs.existsSync(this._injectSocketPath)) {
          fs.unlinkSync(this._injectSocketPath);
        }
      } catch {
        // Ignore
      }
      this._injectSocketPath = null;
    }
  }
}

/**
 * Factory options — alternative object-based signature.
 */
export interface CreatePtySessionOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  engineName?: string;
  cols?: number;
  rows?: number;
  onData?: (data: string) => void;
  onExit?: (code: number) => void;
}

/**
 * Factory function for creating PtySession instances.
 * Accepts either positional args or an options object.
 */
export function createPtySession(opts: CreatePtySessionOptions): PtySession;
export function createPtySession(command: string, args: string[], opts?: PtySessionOptions): PtySession;
export function createPtySession(
  commandOrOpts: string | CreatePtySessionOptions,
  args?: string[],
  opts?: PtySessionOptions,
): PtySession {
  if (typeof commandOrOpts === "string") {
    return new PtySession(commandOrOpts, args ?? [], opts);
  }
  const o = commandOrOpts;
  const session = new PtySession(o.cmd, o.args ?? [], {
    cwd: o.cwd,
    env: o.env,
    cols: o.cols,
    rows: o.rows,
    engine: o.engineName,
  });
  if (o.onData) session.on("pty-data", o.onData);
  if (o.onExit) session.on("exit", o.onExit);
  return session;
}
