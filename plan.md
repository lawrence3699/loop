# Loop CLI — Implementation Plan

> **Iterative Multi-Engine AI Orchestration**
>
> Merges [ufoo](https://github.com/Icyoung/ufoo) (multi-agent orchestration framework) and [iterloop](../claude-gemini-loop/iterloop-v0.15) (iterative AI engine collaboration loop) into a single, unified CLI tool.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Design](#2-architecture-design)
3. [Module Specifications](#3-module-specifications)
4. [Agent Team & Workflow](#4-agent-team--workflow)
5. [Implementation Phases](#5-implementation-phases)
6. [Quality Gates](#6-quality-gates)
7. [Testing Strategy](#7-testing-strategy)
8. [Website & Deployment](#8-website--deployment)
9. [Risk Register](#9-risk-register)
10. [Appendix: Source Project Analysis](#10-appendix-source-project-analysis)

---

## 1. Project Overview

### 1.1 What We're Building

**loop-cli** is a TypeScript CLI tool that provides:

- **Iterative execution loop**: Executor engine produces output → Reviewer engine scores (1–10) → Feedback fed back → Loop until approved or max iterations
- **Multi-engine support**: Claude CLI, Gemini CLI, Codex CLI, and custom engines via a unified `Engine` interface
- **File-based event bus**: Append-only JSONL event streaming for inter-agent communication — crash-safe, git-friendly, zero external dependencies
- **Background daemon**: Agent lifecycle management, IPC server, activity-aware routing
- **Agent wrappers**: `lclaude`, `lgemini`, `lcodex` — transforms CLI agents into collaborative loop participants
- **Skills system**: Executable markdown (SKILL.md) auto-injected into agent prompts
- **Interactive TUI**: `@clack/prompts` guided setup + `blessed` dashboard for real-time monitoring
- **Terminal adapters**: Pluggable backends for Terminal.app, iTerm2, tmux, PTY emulation

### 1.2 Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Local-first** | No external message brokers, databases, or cloud services. Everything is files. |
| **Crash-safe** | Append-only JSONL + file locks + offset tracking = recoverable after any failure |
| **TypeScript strict** | Full strict mode, no `any` escape hatches, comprehensive type definitions |
| **Minimal dependencies** | Reuse what iterloop already uses; add only what's necessary from ufoo's patterns |
| **macOS-first** | Primary target is darwin; Linux compatibility as secondary goal |
| **Composable** | Each module works independently; the whole is greater than the sum of parts |

### 1.3 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (strict, ESM) | iterloop is already TS; ufoo's JS patterns translate cleanly |
| Module system | ESM (`"type": "module"`) | Modern Node.js standard, matches iterloop |
| Build tool | `tsc` (TypeScript compiler) | Simple, reliable, no bundler complexity needed for CLI |
| Test framework | Vitest | Faster than Jest, native ESM support, compatible API |
| CLI framework | Commander.js | Both projects already use it |
| PTY library | `node-pty` | Both projects use it; proven cross-platform support |
| Interactive UI | `@clack/prompts` | iterloop's approach — cleaner than blessed for guided setup |
| Dashboard UI | `blessed` | ufoo's approach — necessary for real-time multi-agent monitoring |
| Package name | `loop-cli` | Clear, memorable, available |
| Config format | JSON | Simple, no extra parser needed |
| Event format | JSONL | Proven in ufoo — append-only, line-delimited, grep-friendly |
| IPC mechanism | Unix domain socket | Proven in ufoo — fast, reliable, no port conflicts |

### 1.4 Package Metadata

```json
{
  "name": "loop-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "loop": "./dist/index.js",
    "lclaude": "./dist/bin/lclaude.js",
    "lgemini": "./dist/bin/lgemini.js",
    "lcodex": "./dist/bin/lcodex.js"
  },
  "engines": { "node": ">=18" }
}
```

---

## 2. Architecture Design

### 2.1 Directory Structure

```
/Users/lawrence/Desktop/loop/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                    # CLI entry point (commander)
│   ├── bin/
│   │   ├── lclaude.ts              # Claude agent wrapper entry
│   │   ├── lgemini.ts              # Gemini agent wrapper entry
│   │   └── lcodex.ts               # Codex agent wrapper entry
│   ├── core/
│   │   ├── loop.ts                 # Core iteration loop orchestration
│   │   ├── engine.ts               # Engine abstraction & factory
│   │   ├── conversation.ts         # Multi-turn PTY conversation
│   │   ├── protocol.ts             # IterloopMessage v2 structured protocol
│   │   └── scoring.ts              # Review scoring, approval, threshold logic
│   ├── bus/
│   │   ├── event-bus.ts            # File-based event bus (JSONL)
│   │   ├── store.ts                # Bus persistence & crash recovery
│   │   ├── queue.ts                # Per-agent message queue management
│   │   ├── subscriber.ts           # Agent subscription lifecycle
│   │   ├── message.ts              # Message routing, seq locking, targeting
│   │   └── daemon.ts               # Bus daemon — background delivery worker
│   ├── agent/
│   │   ├── launcher.ts             # Agent launcher with ready detection
│   │   ├── pty-session.ts          # PTY wrapper (merged ufoo + iterloop)
│   │   ├── activity.ts             # Activity-aware state tracking
│   │   ├── ready-detector.ts       # Agent initialization detection
│   │   └── wrapper.ts              # CLI agent wrapper logic
│   ├── orchestrator/
│   │   ├── daemon.ts               # Background orchestrator daemon
│   │   ├── ipc-server.ts           # Unix socket IPC server
│   │   ├── group.ts                # Agent group orchestration
│   │   └── scheduler.ts            # Task scheduling & routing
│   ├── plan/
│   │   ├── shared-plan.ts          # Shared plan coordination (.loop-plan.md)
│   │   ├── decisions.ts            # Architectural decision tracking
│   │   └── context.ts              # Cross-session context persistence
│   ├── skills/
│   │   ├── loader.ts               # Skill discovery from directories
│   │   ├── registry.ts             # Skill registry (global + project)
│   │   └── executor.ts             # Skill injection into prompts
│   ├── ui/
│   │   ├── interactive.ts          # @clack/prompts guided setup
│   │   ├── dashboard.ts            # blessed terminal dashboard
│   │   ├── banner.ts               # Gradient ASCII banner
│   │   ├── renderer.ts             # PTY output renderer
│   │   ├── input.ts                # Raw-mode user input
│   │   └── colors.ts               # Brand colors & ANSI helpers
│   ├── terminal/
│   │   ├── adapter.ts              # Adapter interface + factory router
│   │   ├── terminal-adapter.ts     # Native Terminal.app adapter
│   │   ├── tmux-adapter.ts         # tmux pane adapter
│   │   ├── iterm2-adapter.ts       # iTerm2 adapter
│   │   ├── pty-adapter.ts          # Internal PTY adapter
│   │   └── detect.ts               # Terminal environment detection
│   ├── config/
│   │   ├── index.ts                # Configuration cascade loader
│   │   └── schema.ts               # Config validation & defaults
│   └── utils/
│       ├── pty-filter.ts           # Output filtering & line classification
│       ├── ansi.ts                 # ANSI stripping & handling
│       ├── fs.ts                   # File system utilities
│       ├── lock.ts                 # File-based locking (seq counter)
│       └── process.ts              # PID tracking, signal handling
├── skills/                         # Built-in skills (SKILL.md files)
│   ├── loop/SKILL.md
│   ├── review/SKILL.md
│   └── plan/SKILL.md
├── test/
│   ├── unit/                       # Unit tests (mirrors src/ structure)
│   │   ├── core/
│   │   ├── bus/
│   │   ├── agent/
│   │   ├── orchestrator/
│   │   ├── plan/
│   │   ├── skills/
│   │   ├── terminal/
│   │   ├── config/
│   │   └── utils/
│   └── integration/                # End-to-end tests
│       ├── loop-flow.test.ts
│       ├── bus-delivery.test.ts
│       ├── daemon-lifecycle.test.ts
│       └── cli-commands.test.ts
├── landing/                        # Website (see Section 8)
└── README.md
```

### 2.2 Module Dependency Graph

```
index.ts (CLI entry)
  ├── core/loop.ts
  │     ├── core/engine.ts
  │     ├── core/conversation.ts → agent/pty-session.ts
  │     ├── core/protocol.ts
  │     ├── core/scoring.ts
  │     └── plan/shared-plan.ts
  ├── bus/event-bus.ts
  │     ├── bus/store.ts → utils/fs.ts
  │     ├── bus/queue.ts
  │     ├── bus/subscriber.ts
  │     ├── bus/message.ts → utils/lock.ts
  │     └── bus/daemon.ts
  ├── agent/launcher.ts
  │     ├── agent/pty-session.ts → utils/pty-filter.ts, utils/ansi.ts
  │     ├── agent/activity.ts
  │     ├── agent/ready-detector.ts
  │     └── agent/wrapper.ts → core/engine.ts
  ├── orchestrator/daemon.ts
  │     ├── orchestrator/ipc-server.ts
  │     ├── orchestrator/group.ts
  │     └── orchestrator/scheduler.ts
  ├── plan/ (shared-plan.ts, decisions.ts, context.ts)
  ├── skills/ (loader.ts, registry.ts, executor.ts)
  ├── ui/ (interactive.ts, dashboard.ts, banner.ts, renderer.ts, input.ts, colors.ts)
  ├── terminal/ (adapter.ts + implementations + detect.ts)
  └── config/ (index.ts, schema.ts)
```

**Rule**: No circular dependencies. Dependency flows downward. `utils/` depends on nothing. `config/` depends only on `utils/`. Higher modules depend on lower modules only.

### 2.3 Data Flow: Iteration Loop

```
User runs: loop "Build a REST API" --executor claude --reviewer gemini

                    ┌─────────────────────────────────────────────┐
                    │              ITERATION LOOP                   │
                    │                                               │
  ┌──────────┐     │  ┌──────────┐    ┌──────────┐   ┌─────────┐ │
  │  User     │────▶│  │ Executor │───▶│ Protocol │──▶│Reviewer │ │
  │  Task     │     │  │ (Claude) │    │ Format   │   │(Gemini) │ │
  └──────────┘     │  └──────────┘    └──────────┘   └────┬────┘ │
                    │       ▲                               │      │
                    │       │         ┌──────────┐          │      │
                    │       └─────────│ Scoring  │◀─────────┘      │
                    │                 │ Engine   │                  │
                    │                 └────┬─────┘                  │
                    │                      │                        │
                    │              score >= threshold?              │
                    │              ├── YES → APPROVED               │
                    │              └── NO  → next iteration         │
                    └─────────────────────────────────────────────┘
                                       │
                              ┌────────┴────────┐
                              │  Shared Plan     │
                              │ .loop-plan.md    │
                              └─────────────────┘
```

### 2.4 Data Flow: Event Bus & Multi-Agent

```
  Agent A (lclaude)          Event Bus               Agent B (lgemini)
  ┌───────────┐         ┌──────────────┐          ┌───────────┐
  │           │──send──▶│              │          │           │
  │           │         │  .loop/bus/  │          │           │
  │           │         │  events/     │──queue──▶│           │
  │           │         │  {date}.jsonl│          │           │
  │           │         │              │          │           │
  │           │◀─inject─│  Bus Daemon  │◀─poll───│           │
  └───────────┘         └──────┬───────┘          └───────────┘
                               │
                      ┌────────┴────────┐
                      │  Orchestrator   │
                      │  Daemon         │
                      │  (.loop/run/    │
                      │   loop.sock)    │
                      └─────────────────┘
```

### 2.5 Runtime Directory Layout

```
<project>/
├── .loop/
│   ├── config.json                    # Project-level config
│   ├── bus/
│   │   ├── events/
│   │   │   └── {YYYY-MM-DD}.jsonl     # Append-only event log
│   │   ├── queues/
│   │   │   └── {subscriberId}/
│   │   │       ├── pending.jsonl      # Pending messages for agent
│   │   │       └── tty                # Agent TTY info
│   │   ├── offsets/
│   │   │   └── {subscriberId}.offset  # Consumption offset
│   │   ├── seq.counter                # Monotonic message sequence
│   │   └── seq.counter.lock           # File lock for seq
│   ├── run/
│   │   ├── loop-daemon.pid            # Daemon PID file
│   │   ├── loop-daemon.log            # Daemon log
│   │   ├── loop.sock                  # IPC Unix socket
│   │   └── queues/
│   │       └── {subscriberId}/
│   │           └── inject.sock        # Per-agent inject socket
│   ├── context/
│   │   └── decisions/
│   │       └── {NNN}-{slug}.md        # YAML frontmatter decision docs
│   ├── agents/
│   │   └── all-agents.json            # Agent registry
│   └── plans/
│       └── .loop-plan.md              # Shared iteration plan
│
├── SKILLS/                            # Project-level skills
│   └── custom/SKILL.md
└── ...
```

Global config: `~/.loop/config.json`
Global skills: `~/.loop/skills/`

---

## 3. Module Specifications

### 3.1 `src/core/engine.ts` — Engine Abstraction

**Source**: Ported from iterloop's `engine.ts` (372 lines), enhanced with ufoo's provider patterns.

```typescript
// Key types
export type EngineName = "claude" | "gemini" | "codex";

export interface RunOptions {
  cwd?: string;
  verbose?: boolean;
  onData?: (chunk: string) => void;
  onStatus?: (status: string) => void;
  passthroughArgs?: string[];
  timeout?: number;
}

export interface InteractiveOptions {
  cwd?: string;
  args?: string[];
  cols?: number;
  rows?: number;
}

export interface Engine {
  name: EngineName;
  label: string;
  color: (s: string) => string;    // Brand color function
  checkVersion(): string;           // Returns version string or throws
  run(prompt: string, opts: RunOptions): Promise<string>;
  interactive(opts: InteractiveOptions): PtySession;
}

export function createEngine(name: EngineName): Engine;
```

**Implementation notes**:
- Port iterloop's `createClaude()`, `createGemini()`, `createCodex()` directly
- Keep Claude's `--output-format stream-json` parsing for status updates
- Add engine brand colors from iterloop's `colors.ts`
- Version check via `<cli> --version` with try/catch

### 3.2 `src/core/loop.ts` — Core Iteration Loop

**Source**: Ported from iterloop's `loop.ts` (180 lines), enhanced with event bus integration.

```typescript
export interface LoopOptions {
  task: string;
  maxIterations: number;
  executor: Engine;
  reviewer: Engine;
  cwd: string;
  verbose: boolean;
  mode: { current: ExecutionMode };
  passthroughArgs?: string[];
  threshold: number;              // NEW: configurable (default 9)
  useBus: boolean;                // NEW: emit events to bus
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult>;
```

**Key changes from iterloop**:
- Add configurable `threshold` (iterloop hard-coded "APPROVED" keyword only)
- Score-based approval: `score >= threshold` OR explicit "APPROVED" keyword
- Emit iteration events to event bus when `useBus: true`
- Call `shared-plan.ts` for context carry-over between iterations
- Structured `LoopResult` return type with full iteration history

### 3.3 `src/core/conversation.ts` — Multi-Turn Conversation

**Source**: Ported from iterloop's `conversation.ts` (244 lines).

```typescript
export interface ConversationOptions {
  engine: Engine;
  initialPrompt: string;
  cwd: string;
  verbose: boolean;
  mode: { current: ExecutionMode };
  passthroughArgs?: string[];
  onContent?: (line: string) => void;
}

export interface ConversationResult {
  finalOutput: string;
  duration_ms: number;
  bytes_received: number;
}

export async function runConversation(opts: ConversationOptions): Promise<ConversationResult>;
```

**Implementation notes**:
- Port iterloop's idle detection (2s debounce, 30s auto / 5s manual silence timeout)
- Port Shift+Tab mode toggle, Ctrl+D done, double Ctrl+C cancel
- Integrate with `agent/pty-session.ts` for PTY management
- Use `ui/renderer.ts` for live output display

### 3.4 `src/core/protocol.ts` — Structured Message Protocol

**Source**: Ported from iterloop's `protocol.ts` (217 lines), versioned as `loop-v1`.

```typescript
export interface LoopMessage {
  protocol: "loop-v1";            // Changed from "iterloop-v1"
  timestamp: string;
  iteration: number;
  role: "executor" | "reviewer";
  engine: EngineName;
  task: {
    original: string;
    context: string;
  };
  output: {
    text: string;
    files_changed: string[];
    commands_executed: string[];
    status: "completed" | "needs_revision" | "error";
  };
  review?: {
    score: number;
    issues: string[];
    suggestions: string[];
    approved: boolean;
  };
  metadata: {
    duration_ms: number;
    bytes_received: number;
    model?: string;
  };
}

export function createExecutorMessage(/* ... */): LoopMessage;
export function parseReviewerOutput(/* ... */): LoopMessage;
export function formatForReviewer(msg: LoopMessage): string;
```

**Implementation notes**:
- Direct port of iterloop's protocol with namespace rename
- Keep file/command extraction regexes
- Keep score parsing regex: `/(?:score|rating)\s*:?\s*(\d+)\s*(?:\/\s*10)?/i`

### 3.5 `src/core/scoring.ts` — Review Scoring & Approval

**Source**: New module, extracted from iterloop's inline approval logic.

```typescript
export interface ScoringConfig {
  threshold: number;              // Default: 9
  requireExplicitApproval: boolean; // Default: false
}

export interface ScoringResult {
  score: number;
  approved: boolean;
  reason: string;
}

export function evaluateReview(review: LoopMessage["review"], config: ScoringConfig): ScoringResult;
```

**Logic**:
- If `requireExplicitApproval`: only approve on explicit "APPROVED" keyword (iterloop behavior)
- Otherwise: approve if `score >= threshold` OR explicit "APPROVED"
- Returns structured result with human-readable reason

### 3.6 `src/bus/event-bus.ts` — File-Based Event Bus

**Source**: Rewritten from ufoo's `src/bus/index.js` (850 lines) in TypeScript.

```typescript
export interface BusEvent {
  seq: number;
  timestamp: string;
  type: "message/targeted" | "message/broadcast" | "status/agent" | "status/delivery";
  event: string;
  publisher: string;
  target: string;                 // subscriberId | nickname | agentType | "*"
  data: Record<string, unknown>;
}

export interface EventBusOptions {
  projectRoot: string;
}

export class EventBus {
  constructor(opts: EventBusOptions);

  // Lifecycle
  async init(): Promise<void>;
  async shutdown(): Promise<void>;

  // Publishing
  async send(publisher: string, target: string, message: string): Promise<BusEvent>;
  async broadcast(publisher: string, message: string): Promise<BusEvent>;

  // Subscribing
  async join(agentType: string, metadata: AgentMetadata): Promise<string>; // returns subscriberId
  async leave(subscriberId: string): Promise<void>;

  // Consuming
  async check(subscriberId: string): Promise<BusEvent[]>;
  async consume(subscriberId: string): Promise<BusEvent[]>;

  // Status
  async status(): Promise<BusStatus>;
  async agents(): Promise<AgentInfo[]>;
}
```

**Key ufoo patterns to preserve**:
- Append-only JSONL in `.loop/bus/events/{YYYY-MM-DD}.jsonl`
- Per-agent pending queues in `.loop/bus/queues/{subscriberId}/pending.jsonl`
- File-based seq counter with lock file (`utils/lock.ts`)
- Offset tracking in `.loop/bus/offsets/{subscriberId}.offset`
- Target resolution: exact ID → nickname → agentType → wildcard `*`
- Stale agent cleanup via PID checking

### 3.7 `src/bus/store.ts` — Bus Persistence

**Source**: Ported from ufoo's `src/bus/store.js`.

```typescript
export class BusStore {
  constructor(busDir: string);
  async load(): Promise<StoredState>;
  async appendEvent(event: BusEvent): Promise<void>;
  async appendToQueue(subscriberId: string, event: BusEvent): Promise<void>;
  async consumeQueue(subscriberId: string): Promise<BusEvent[]>;
  async getOffset(subscriberId: string): Promise<number>;
  async setOffset(subscriberId: string, seq: number): Promise<void>;
}
```

### 3.8 `src/bus/queue.ts` — Queue Management

**Source**: Ported from ufoo's `src/bus/queue.js`.

```typescript
export class QueueManager {
  constructor(busDir: string);
  async enqueue(subscriberId: string, event: BusEvent): Promise<void>;
  async dequeue(subscriberId: string): Promise<BusEvent[]>;
  async peek(subscriberId: string): Promise<BusEvent[]>;
  async clear(subscriberId: string): Promise<void>;
}
```

### 3.9 `src/bus/subscriber.ts` — Subscriber Lifecycle

**Source**: Ported from ufoo's `src/bus/subscriber.js`.

```typescript
export interface AgentMetadata {
  agent_type: string;
  nickname: string;
  status: "active" | "inactive";
  pid: number;
  tty?: string;
  tmux_pane?: string;
  launch_mode: LaunchMode;
  activity_state: ActivityState;
  last_activity?: string;
}

export class SubscriberManager {
  async register(agentType: string, metadata: AgentMetadata): Promise<string>;
  async unregister(subscriberId: string): Promise<void>;
  async rename(subscriberId: string, nickname: string): Promise<void>;
  async updateMetadata(subscriberId: string, updates: Partial<AgentMetadata>): Promise<void>;
  async cleanupInactive(): Promise<string[]>;
  async list(): Promise<Map<string, AgentMetadata>>;
}
```

### 3.10 `src/bus/message.ts` — Message Routing

**Source**: Ported from ufoo's `src/bus/message.js`.

```typescript
export class MessageManager {
  constructor(busDir: string, subscriberManager: SubscriberManager);
  async nextSeq(): Promise<number>;           // File-locked monotonic counter
  async resolveTarget(target: string): Promise<string[]>; // Target resolution
  async route(event: BusEvent): Promise<void>; // Route to target queues
}
```

### 3.11 `src/bus/daemon.ts` — Bus Daemon

**Source**: Simplified from ufoo's `src/bus/daemon.js`.

```typescript
export class BusDaemon {
  constructor(eventBus: EventBus, opts: BusDaemonOptions);
  async start(): Promise<void>;    // Start watch loop
  async stop(): Promise<void>;     // Graceful shutdown
  // Background: poll queues → deliver to agents via inject sockets
}
```

### 3.12 `src/agent/launcher.ts` — Agent Launcher

**Source**: Ported from ufoo's `src/agent/launcher.js` (814 lines), simplified.

```typescript
export interface LaunchOptions {
  agentType: string;
  engine: Engine;
  cwd: string;
  launchMode: LaunchMode;
  nickname?: string;
  args?: string[];
}

export class AgentLauncher {
  async launch(opts: LaunchOptions): Promise<LaunchedAgent>;
  // Handles: daemon registration, PTY spawn, ready detection,
  //          inject socket setup, cleanup on exit
}
```

**Key ufoo patterns to preserve**:
- `ensureDaemon()` → start daemon if not running
- `registerWithDaemon()` → IPC registration
- PTY detection (auto, force, disable via env vars)
- Ready detection via `ready-detector.ts`
- Inject socket per agent for command injection
- Session reuse (find previous session by TTY/tmux pane)
- Signal handlers (SIGTERM, SIGINT) for graceful cleanup

### 3.13 `src/agent/pty-session.ts` — PTY Session (Merged)

**Source**: Merged from iterloop's `pty-session.ts` + ufoo's `src/agent/ptyWrapper.js`.

This is the most critical merge point. We combine:
- **iterloop**: Event-based PTY (`EventEmitter`), content/status/ignore classification, ring buffer for prompt detection, 50KB output cap
- **ufoo**: JSONL I/O logging, inject socket protocol, output subscriptions, resize handling

```typescript
export class PtySession extends EventEmitter {
  constructor(command: string, args: string[], opts: PtySessionOptions);

  // From iterloop
  on(event: "content", listener: (line: string) => void): this;
  on(event: "status", listener: (status: string) => void): this;
  on(event: "idle", listener: () => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "pty-data", listener: (data: string) => void): this;

  // From ufoo
  enableLogging(logDir: string): void;
  enableInjectSocket(socketPath: string): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  getTranscript(): string;

  // Lifecycle
  kill(): void;
  destroy(): void;
}
```

**Merge strategy**:
- Use iterloop's `EventEmitter` pattern as the base (cleaner than callbacks)
- Add ufoo's logging (JSONL I/O capture) as optional `enableLogging()`
- Add ufoo's inject socket as optional `enableInjectSocket()`
- Keep iterloop's output classification (`classifyLine`) in `utils/pty-filter.ts`
- Keep iterloop's ring buffer for prompt detection
- Keep ufoo's PTY socket contract for inter-process inject/raw/resize/subscribe

### 3.14 `src/agent/activity.ts` — Activity State Tracking

**Source**: Ported from ufoo's `src/agent/activityDetector.js`.

```typescript
export type ActivityState = "idle" | "working" | "starting" | "waiting_input" | "blocked";

export class ActivityDetector {
  constructor(ptySession: PtySession);
  getState(): ActivityState;
  onStateChange(listener: (state: ActivityState) => void): void;
  destroy(): void;
}
```

### 3.15 `src/agent/ready-detector.ts` — Ready Detection

**Source**: Ported from ufoo's `src/agent/readyDetector.js`.

```typescript
export class ReadyDetector {
  constructor(ptySession: PtySession);
  onReady(callback: () => void): void;
  // Detects when agent CLI has finished initialization
  // and is ready to accept input (prompt pattern detection)
}
```

### 3.16 `src/agent/wrapper.ts` — Agent Wrapper Logic

**Source**: New module combining ufoo's wrapper concept with iterloop's engine interface.

```typescript
// Used by lclaude, lgemini, lcodex entry points
export async function launchWrappedAgent(engineName: EngineName): Promise<void>;
// Handles: engine creation, launcher invocation, bus registration,
// skill injection, event forwarding
```

### 3.17 `src/orchestrator/daemon.ts` — Orchestrator Daemon

**Source**: Ported from ufoo's `src/daemon/index.js` (large), significantly simplified.

```typescript
export class OrchestratorDaemon {
  constructor(projectRoot: string);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  isRunning(): boolean;

  // Agent management
  async launchAgent(opts: LaunchOptions): Promise<string>;
  async closeAgent(subscriberId: string): Promise<void>;
  async resumeAgents(): Promise<void>;

  // Status
  async getStatus(): Promise<DaemonStatus>;
}
```

**Key behaviors from ufoo**:
- Daemonize as background process (detached, stdio: ignore)
- PID file at `.loop/run/loop-daemon.pid`
- Log file at `.loop/run/loop-daemon.log`
- Graceful shutdown on SIGTERM/SIGINT
- Periodic stale agent cleanup
- Manage bus daemon lifecycle

### 3.18 `src/orchestrator/ipc-server.ts` — IPC Server

**Source**: Ported from ufoo's `src/daemon/ipcServer.js`.

```typescript
export interface IpcRequest {
  type: IpcRequestType;
  data: Record<string, unknown>;
}

export type IpcRequestType =
  | "REGISTER_AGENT" | "AGENT_READY" | "AGENT_REPORT"
  | "LAUNCH_AGENT" | "CLOSE_AGENT" | "RESUME_AGENTS"
  | "STATUS" | "BUS_SEND" | "BUS_CHECK"
  | "LAUNCH_GROUP" | "STOP_GROUP";

export class IpcServer {
  constructor(socketPath: string, daemon: OrchestratorDaemon);
  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

### 3.19 `src/orchestrator/group.ts` — Agent Group Orchestration

**Source**: Ported from ufoo's `src/daemon/groupOrchestrator.js`.

```typescript
export interface AgentGroup {
  name: string;
  agents: GroupAgent[];
  strategy: "parallel" | "sequential" | "pipeline";
}

export class GroupOrchestrator {
  async launchGroup(group: AgentGroup): Promise<void>;
  async stopGroup(name: string): Promise<void>;
  async listGroups(): Promise<AgentGroup[]>;
}
```

### 3.20 `src/orchestrator/scheduler.ts` — Task Scheduling

**Source**: New module, inspired by ufoo's activity-aware routing.

```typescript
export class Scheduler {
  async assignTask(task: string, agents: AgentInfo[]): Promise<string>; // returns subscriberId
  async routeMessage(target: string, message: string): Promise<void>;
  // Activity-aware: prefer idle agents over working ones
}
```

### 3.21 `src/plan/shared-plan.ts` — Shared Plan

**Source**: Ported from iterloop's `shared-plan.ts` (272 lines).

```typescript
export async function initSharedPlan(cwd: string, task: string): Promise<void>;
export async function updateSharedPlan(cwd: string, record: IterationRecord, filesChanged: string[]): Promise<void>;
export async function getExecutorContext(cwd: string): Promise<string>;
export async function getReviewerContext(cwd: string): Promise<string>;
```

**Changes from iterloop**:
- File renamed to `.loop-plan.md`
- Add integration with decision tracking
- Keep fail-silent behavior (never crash on write failure)

### 3.22 `src/plan/decisions.ts` — Decision Tracking

**Source**: Ported from ufoo's context/decisions system.

```typescript
export interface Decision {
  id: number;
  title: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
  context: string;
  decision: string;
  consequences: string;
  date: string;
}

export async function addDecision(cwd: string, decision: Omit<Decision, "id" | "date">): Promise<Decision>;
export async function listDecisions(cwd: string): Promise<Decision[]>;
export async function resolveDecision(cwd: string, id: number, status: Decision["status"]): Promise<void>;
```

### 3.23 `src/plan/context.ts` — Context Persistence

**Source**: New module combining iterloop's plan context with ufoo's decision context.

```typescript
export async function buildContext(cwd: string): Promise<string>;
// Combines: last iteration score/feedback + decision log + file changes
// Used to inject context into executor prompts
```

### 3.24 `src/skills/loader.ts` — Skill Discovery

**Source**: Ported from ufoo's skills system.

```typescript
export interface Skill {
  name: string;
  description: string;
  content: string;              // Markdown content
  path: string;                 // File path
  scope: "global" | "project";
}

export async function discoverSkills(cwd: string): Promise<Skill[]>;
// Search order:
// 1. <project>/SKILLS/*/SKILL.md
// 2. ~/.loop/skills/*/SKILL.md
// 3. <package>/skills/*/SKILL.md (built-in)
```

### 3.25 `src/skills/registry.ts` — Skill Registry

```typescript
export class SkillRegistry {
  async load(cwd: string): Promise<void>;
  get(name: string): Skill | undefined;
  list(): Skill[];
  async add(name: string, content: string, scope: "global" | "project"): Promise<void>;
}
```

### 3.26 `src/skills/executor.ts` — Skill Injection

```typescript
export function injectSkills(prompt: string, skills: Skill[]): string;
// Prepends skill content to prompt with clear delimiters
```

### 3.27 `src/ui/interactive.ts` — Interactive Setup

**Source**: Ported from iterloop's `interactive.ts` (174 lines).

```typescript
export async function interactive(): Promise<LoopConfig>;
// 11-step guided flow using @clack/prompts:
// 1. Banner
// 2. Working directory
// 3. Executor engine
// 4. Reviewer engine
// 5. Native CLI flags
// 6. Task description
// 7. Execution mode (auto/manual)
// 8. Max iterations
// 9. Score threshold (NEW)
// 10. Verbose toggle
// 11. Confirm & launch
```

### 3.28 `src/ui/dashboard.ts` — Terminal Dashboard

**Source**: Ported from ufoo's `src/chat/dashboardView.js` (blessed-based).

```typescript
export class Dashboard {
  constructor();
  start(): void;
  stop(): void;
  // Panels: agent directory, message stream, status bar, input
}
```

### 3.29 `src/ui/banner.ts` — ASCII Banner

**Source**: Ported from iterloop's `banner.ts`, redesigned for "loop" branding.

```typescript
export function renderBanner(): void;
// Gradient ASCII art "loop" logo
// Engine status display (installed/missing)
```

### 3.30 `src/ui/renderer.ts` — PTY Output Renderer

**Source**: Ported from iterloop's `pty-renderer.ts` (121 lines).

```typescript
export class PtyRenderer {
  start(engine: Engine, role: string): void;
  write(data: string): void;
  stop(stats: { elapsed_ms: number; bytes: number }): void;
}
```

### 3.31 `src/ui/input.ts` — Raw-Mode Input

**Source**: Ported from iterloop's `input.ts` (116 lines).

```typescript
export interface PromptResult {
  value: string;
  action: "submit" | "done" | "cancel";
}
export function promptUser(opts: { hint?: string; mode?: string }): Promise<PromptResult>;
```

### 3.32 `src/ui/colors.ts` — Brand Colors

**Source**: Merged from iterloop's `colors.ts` + ufoo's chalk patterns.

```typescript
// Engine brand colors
export const claude: (s: string) => string;   // Orange #F07623
export const gemini: (s: string) => string;   // Blue #4285F4
export const codex: (s: string) => string;    // Green #10A37F
export const loop: (s: string) => string;     // Gradient (brand)

// Standard semantic colors
export const success: (s: string) => string;
export const error: (s: string) => string;
export const warn: (s: string) => string;
export const dim: (s: string) => string;
```

### 3.33 `src/terminal/adapter.ts` — Terminal Adapter Interface

**Source**: Ported from ufoo's `src/terminal/adapterRouter.js` + `adapterContract.js`.

```typescript
export type LaunchMode = "terminal" | "tmux" | "iterm2" | "pty" | "auto";

export interface TerminalCapabilities {
  supportsActivate: boolean;
  supportsInjection: boolean;
  supportsSessionReuse: boolean;
  supportsResize: boolean;
  supportsSnapshot: boolean;
}

export interface TerminalAdapter {
  mode: LaunchMode;
  capabilities: TerminalCapabilities;
  launch(command: string, args: string[], opts: AdapterLaunchOptions): Promise<LaunchedProcess>;
  inject(pid: number, command: string): Promise<void>;
  activate(pid: number): Promise<void>;
}

export function createAdapter(mode: LaunchMode): TerminalAdapter;
```

### 3.34 `src/terminal/detect.ts` — Terminal Detection

**Source**: Ported from ufoo's terminal detection logic.

```typescript
export function detectTerminal(): LaunchMode;
// Checks: TMUX env → iTerm2 profile → fallback to PTY
```

### 3.35 `src/config/index.ts` — Configuration

```typescript
export interface LoopConfig {
  // Engine defaults
  defaultExecutor: EngineName;
  defaultReviewer: EngineName;

  // Loop defaults
  maxIterations: number;
  threshold: number;
  mode: ExecutionMode;

  // Daemon
  launchMode: LaunchMode;
  autoResume: boolean;

  // Paths
  skillsDir?: string;
}

export async function loadConfig(cwd: string): Promise<LoopConfig>;
// Cascade: defaults → ~/.loop/config.json → <project>/.loop/config.json → env vars
```

### 3.36 `src/config/schema.ts` — Config Validation

```typescript
export function validateConfig(raw: unknown): LoopConfig;
// Validates types, ranges, enum values
// Returns defaults for missing fields
```

### 3.37 `src/utils/pty-filter.ts` — Output Filtering

**Source**: Extracted from iterloop's `pty-session.ts` classification logic.

```typescript
export type LineClass = "content" | "status" | "ignore";
export function classifyLine(line: string, engine: EngineName): LineClass;
export function filterOutput(raw: string, engine: EngineName): string;
export function deduplicateLines(lines: string[]): string[];
```

### 3.38 `src/utils/ansi.ts` — ANSI Handling

```typescript
export function stripAnsi(s: string): string;
export function isAnsiOnly(s: string): boolean;
```

### 3.39 `src/utils/lock.ts` — File-Based Locking

**Source**: Ported from ufoo's seq counter locking.

```typescript
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, timeout?: number): Promise<T>;
export async function nextSeq(counterPath: string, lockPath: string): Promise<number>;
```

### 3.40 `src/utils/fs.ts` — File System Utilities

```typescript
export async function ensureDir(dir: string): Promise<void>;
export async function appendJsonl(filePath: string, data: unknown): Promise<void>;
export async function readJsonl<T>(filePath: string): Promise<T[]>;
export async function safeWriteFile(filePath: string, content: string): Promise<void>;
```

### 3.41 `src/utils/process.ts` — Process Utilities

```typescript
export function isProcessAlive(pid: number): boolean;
export function setupSignalHandlers(cleanup: () => Promise<void>): void;
export function daemonize(script: string, args: string[], opts: DaemonizeOptions): number; // returns PID
```

### 3.42 `src/index.ts` — CLI Entry Point

**Source**: Merged from iterloop's `index.ts` + ufoo's `src/cli.js`.

```typescript
#!/usr/bin/env node

// Commander program definition:
//
// loop [task]                           → interactive or direct execution
// loop daemon start|stop|status         → daemon management
// loop bus send|check|status            → event bus operations
// loop chat                             → interactive dashboard
// loop plan show|clear                  → plan management
// loop ctx add|list|resolve             → decision tracking
// loop skills list|add                  → skills management
//
// Options:
// -e, --executor <engine>               → default: claude
// -r, --reviewer <engine>               → default: gemini
// -n, --iterations <number>             → default: 3
// -d, --dir <path>                      → working directory
// -v, --verbose                         → stream live output
// --auto                                → auto mode
// --pass <args...>                      → forward to executor
// --threshold <number>                  → approval score (default: 9)
```

---

## 4. Agent Team & Workflow

### 4.1 Team Roster

| Agent | Role | Modules | Works On |
|-------|------|---------|----------|
| **architect** | Design specs, interface contracts, PR review | All interfaces | Phase 1 |
| **core-engine** | Core iteration logic | `src/core/*` | Phase 2 |
| **bus-developer** | Event bus & orchestrator | `src/bus/*`, `src/orchestrator/*` | Phase 2 |
| **agent-developer** | Agent launcher, PTY, terminal | `src/agent/*`, `src/terminal/*` | Phase 2 |
| **ui-developer** | CLI, dashboard, skills, plan, config | `src/ui/*`, `src/skills/*`, `src/plan/*`, `src/config/*`, `src/index.ts` | Phase 2 |
| **website-developer** | Landing page, deployment | `landing/*`, server deploy | Phase 2–3 |
| **test-engineer** | Unit + integration tests | `test/*` | Phase 3 |
| **code-reviewer** | Code quality review | All `src/` | Phase 3 |
| **architecture-reviewer** | Design compliance | All modules | Phase 3 |
| **security-reviewer** | Vulnerability audit | Shell exec, file ops, IPC | Phase 3 |
| **integration-tester** | E2E workflow tests | `test/integration/*` | Phase 4 |
| **performance-reviewer** | Perf profiling | Daemon, bus, PTY | Phase 4 |

### 4.2 Workflow Sequence

```
Phase 1: Architecture (architect)
  │
  ├── Read both source projects
  ├── Produce interface definitions for all modules
  ├── Define module boundaries and dependency rules
  └── Output: This plan.md + src/ skeleton with type-only files
  │
  ▼  GATE 1: Architecture design approved ✓
  │
Phase 2: Parallel Implementation
  │
  ├── core-engine ──────▶ src/core/* + src/utils/pty-filter.ts, ansi.ts
  ├── bus-developer ────▶ src/bus/* + src/orchestrator/* + src/utils/lock.ts, fs.ts, process.ts
  ├── agent-developer ──▶ src/agent/* + src/terminal/*
  ├── ui-developer ─────▶ src/ui/* + src/skills/* + src/plan/* + src/config/* + src/index.ts + src/bin/*
  └── website-developer ▶ landing/*
  │
  ▼  Each module → immediate review cycle:
  │
Phase 3: Module-Level Verification (per module, as completed)
  │
  ├── test-engineer: Write unit tests (>80% coverage per module)
  ├── code-reviewer: TypeScript quality, error handling, DRY
  ├── architecture-reviewer: Boundaries, no circular deps, contracts
  └── security-reviewer: Injection, path traversal, input validation
  │
  ▼  GATE 2: All module tests pass (>80% coverage)
  ▼  GATE 3: Code review approved
  ▼  GATE 4: Security review passed
  │
Phase 4: Integration & Performance
  │
  ├── integration-tester: E2E tests (loop flow, bus delivery, daemon lifecycle, CLI)
  └── performance-reviewer: Memory leaks, file I/O efficiency, buffer management
  │
  ▼  GATE 5: Integration tests pass
  ▼  GATE 6: Performance review passed
  │
Phase 5: Website Deploy & Final Review
  │
  ├── website-developer: Deploy to 8.141.95.103
  ├── ALL review agents: Final verification round
  └── Output: Verified, deployable loop-cli
  │
  ▼  GATE 7: Website deployed and accessible
```

---

## 5. Implementation Phases

### Phase 1: Architecture & Scaffolding

**Owner**: architect

**Deliverables**:
1. Initialize npm project (`package.json`, `tsconfig.json`, `vitest.config.ts`)
2. Create directory structure (all dirs under `src/`)
3. Write type-only interface files for all modules (just exports, no implementation)
4. Write this `plan.md`

**Duration estimate**: First step before any implementation.

**Files created**:
```
package.json
tsconfig.json
vitest.config.ts
src/core/engine.ts      (types + Engine interface)
src/core/protocol.ts    (types + LoopMessage interface)
src/core/scoring.ts     (types + ScoringConfig)
src/bus/event-bus.ts     (types + EventBus class stub)
src/agent/pty-session.ts (types + PtySession class stub)
src/terminal/adapter.ts  (types + TerminalAdapter interface)
src/config/schema.ts     (types + LoopConfig interface)
... (all other type files)
```

### Phase 2: Parallel Implementation

#### 2A: core-engine (src/core/)

**Priority order**:
1. `src/utils/ansi.ts` — ANSI stripping (needed by everything)
2. `src/utils/pty-filter.ts` — Output classification (needed by PTY)
3. `src/core/engine.ts` — Engine factory + Claude/Gemini/Codex implementations
4. `src/core/protocol.ts` — Message types, creation, parsing
5. `src/core/scoring.ts` — Score evaluation, approval logic
6. `src/core/conversation.ts` — Multi-turn PTY conversation (depends on pty-session)
7. `src/core/loop.ts` — Core iteration orchestration

**Source mapping**:
| Target | Source | Action |
|--------|--------|--------|
| engine.ts | iterloop/engine.ts | Port to strict TS, add color property |
| protocol.ts | iterloop/protocol.ts | Port, rename protocol to "loop-v1" |
| scoring.ts | NEW (extracted from iterloop/loop.ts) | New module |
| conversation.ts | iterloop/conversation.ts | Port, use merged PtySession |
| loop.ts | iterloop/loop.ts | Port, add threshold + bus integration |

#### 2B: bus-developer (src/bus/ + src/orchestrator/)

**Priority order**:
1. `src/utils/fs.ts` — File utilities (ensureDir, JSONL read/write)
2. `src/utils/lock.ts` — File-based locking
3. `src/utils/process.ts` — PID check, signal handlers, daemonize
4. `src/bus/store.ts` — JSONL persistence layer
5. `src/bus/queue.ts` — Per-agent queue management
6. `src/bus/subscriber.ts` — Agent registration/lifecycle
7. `src/bus/message.ts` — Routing, seq counter, target resolution
8. `src/bus/event-bus.ts` — Main EventBus class (orchestrates above)
9. `src/bus/daemon.ts` — Background delivery worker
10. `src/orchestrator/ipc-server.ts` — Unix socket server
11. `src/orchestrator/daemon.ts` — Background daemon process
12. `src/orchestrator/group.ts` — Group orchestration
13. `src/orchestrator/scheduler.ts` — Task routing

**Source mapping**:
| Target | Source | Action |
|--------|--------|--------|
| store.ts | ufoo/bus/store.js | Rewrite JS→TS |
| queue.ts | ufoo/bus/queue.js | Rewrite JS→TS |
| subscriber.ts | ufoo/bus/subscriber.js | Rewrite JS→TS |
| message.ts | ufoo/bus/message.js | Rewrite JS→TS |
| event-bus.ts | ufoo/bus/index.js | Rewrite JS→TS, simplify |
| daemon.ts (bus) | ufoo/bus/daemon.js | Rewrite JS→TS |
| ipc-server.ts | ufoo/daemon/ipcServer.js | Rewrite JS→TS |
| daemon.ts (orch) | ufoo/daemon/index.js | Rewrite JS→TS, simplify heavily |
| group.ts | ufoo/daemon/groupOrchestrator.js | Rewrite JS→TS |
| scheduler.ts | NEW | New module |

#### 2C: agent-developer (src/agent/ + src/terminal/)

**Priority order**:
1. `src/terminal/detect.ts` — Terminal environment detection
2. `src/terminal/adapter.ts` — Adapter interface + factory
3. `src/terminal/terminal-adapter.ts` — Terminal.app adapter
4. `src/terminal/tmux-adapter.ts` — tmux adapter
5. `src/terminal/iterm2-adapter.ts` — iTerm2 adapter
6. `src/terminal/pty-adapter.ts` — Internal PTY adapter
7. `src/agent/pty-session.ts` — Merged PTY session class
8. `src/agent/ready-detector.ts` — Ready detection
9. `src/agent/activity.ts` — Activity state tracking
10. `src/agent/launcher.ts` — Agent launcher
11. `src/agent/wrapper.ts` — CLI agent wrapper logic

**Source mapping**:
| Target | Source | Action |
|--------|--------|--------|
| detect.ts | ufoo/terminal/ detection logic | Rewrite JS→TS |
| adapter.ts | ufoo/terminal/adapterRouter.js + contract | Rewrite JS→TS |
| terminal-adapter.ts | ufoo/terminal/adapters/terminalAdapter.js | Rewrite JS→TS |
| tmux-adapter.ts | ufoo/terminal/adapters/tmuxAdapter.js | Rewrite JS→TS |
| iterm2-adapter.ts | NEW (reference ufoo patterns) | New adapter |
| pty-adapter.ts | ufoo/terminal/adapters/internalPtyAdapter.js | Rewrite JS→TS |
| pty-session.ts | MERGE iterloop/pty-session.ts + ufoo/agent/ptyWrapper.js | Critical merge |
| ready-detector.ts | ufoo/agent/readyDetector.js | Rewrite JS→TS |
| activity.ts | ufoo/agent/activityDetector.js | Rewrite JS→TS |
| launcher.ts | ufoo/agent/launcher.js | Rewrite JS→TS, simplify |
| wrapper.ts | NEW (combines ufoo wrapper concept + engine interface) | New module |

#### 2D: ui-developer (src/ui/ + src/skills/ + src/plan/ + src/config/ + CLI)

**Priority order**:
1. `src/ui/colors.ts` — Brand colors (needed everywhere)
2. `src/ui/banner.ts` — ASCII banner with gradient
3. `src/config/schema.ts` — Config validation
4. `src/config/index.ts` — Config cascade loader
5. `src/plan/shared-plan.ts` — Shared plan coordination
6. `src/plan/decisions.ts` — Decision tracking
7. `src/plan/context.ts` — Context builder
8. `src/skills/loader.ts` — Skill file discovery
9. `src/skills/registry.ts` — Skill registry
10. `src/skills/executor.ts` — Skill prompt injection
11. `src/ui/input.ts` — Raw-mode user input
12. `src/ui/renderer.ts` — PTY output renderer
13. `src/ui/interactive.ts` — @clack/prompts guided setup
14. `src/ui/dashboard.ts` — blessed TUI dashboard
15. `src/index.ts` — CLI entry point (commander)
16. `src/bin/lclaude.ts`, `src/bin/lgemini.ts`, `src/bin/lcodex.ts` — Wrapper entries
17. Built-in skills: `skills/loop/SKILL.md`, `skills/review/SKILL.md`, `skills/plan/SKILL.md`

**Source mapping**:
| Target | Source | Action |
|--------|--------|--------|
| colors.ts | MERGE iterloop/colors.ts + ufoo chalk patterns | Merge |
| banner.ts | iterloop/banner.ts | Port, redesign for "loop" brand |
| config/* | NEW (inspired by ufoo/config.js) | New in TS |
| shared-plan.ts | iterloop/shared-plan.ts | Port, rename to .loop-plan.md |
| decisions.ts | ufoo/context/decisions logic | Rewrite JS→TS |
| context.ts | NEW | New module |
| skills/* | ufoo/skills system | Rewrite JS→TS |
| input.ts | iterloop/input.ts | Port directly |
| renderer.ts | iterloop/pty-renderer.ts | Port directly |
| interactive.ts | iterloop/interactive.ts | Port, add threshold option |
| dashboard.ts | ufoo/chat/dashboardView.js | Rewrite JS→TS, simplify |
| index.ts | MERGE iterloop/index.ts + ufoo/cli.js | New CLI structure |

#### 2E: website-developer (landing/)

**Deliverables**:
1. Landing page at `landing/index.html`
2. CSS: dark theme, JetBrains Mono, terminal/hacker aesthetic (reference ufoo's `landing/`)
3. Sections: Hero, Features, Quick Start, Architecture, Comparison, Footer
4. Deploy to `8.141.95.103` (root@, password: `123321Ufo.`)

### Phase 3: Module-Level Verification

For **each module** completed in Phase 2:

1. **test-engineer** writes unit tests:
   - `test/unit/core/*.test.ts` — engine factory, protocol parsing, scoring logic, loop flow
   - `test/unit/bus/*.test.ts` — event append, queue FIFO, subscriber lifecycle, message routing, seq locking
   - `test/unit/agent/*.test.ts` — PTY session events, activity detection, ready detection
   - `test/unit/orchestrator/*.test.ts` — IPC request/response, daemon lifecycle
   - `test/unit/plan/*.test.ts` — shared plan CRUD, decision tracking
   - `test/unit/skills/*.test.ts` — skill discovery, injection
   - `test/unit/terminal/*.test.ts` — adapter factory, terminal detection
   - `test/unit/config/*.test.ts` — config cascade, validation
   - `test/unit/utils/*.test.ts` — JSONL, locking, ANSI stripping, PID check
   - Target: **>80% line coverage** per module

2. **code-reviewer** checks:
   - TypeScript strict compliance (no `any`, no `@ts-ignore`)
   - Error handling at module boundaries
   - Consistent naming conventions (camelCase vars, PascalCase types)
   - DRY — no duplicated logic across modules
   - Proper async/await (no floating promises)

3. **architecture-reviewer** verifies:
   - No circular imports (run `madge --circular`)
   - Module boundaries match plan
   - Interface contracts honored (implementations match declared types)
   - Separation of concerns (no UI code in bus, no bus code in core, etc.)

4. **security-reviewer** audits:
   - `child_process` / `node-pty` calls: no command injection via unsanitized input
   - File operations: no path traversal (validate all paths stay within `.loop/`)
   - IPC: validate all incoming requests, reject malformed data
   - No credentials in source code (config only)
   - Input validation at CLI boundary (commander options)

### Phase 4: Integration & Performance

1. **integration-tester** runs E2E:
   - `test/integration/loop-flow.test.ts` — Full executor→reviewer→approval loop with mock engines
   - `test/integration/bus-delivery.test.ts` — Multi-agent message send/receive via bus
   - `test/integration/daemon-lifecycle.test.ts` — Start/stop/status daemon, agent registration
   - `test/integration/cli-commands.test.ts` — All CLI subcommands produce expected output

2. **performance-reviewer** checks:
   - Daemon memory after 1000+ events (no leak)
   - Bus append throughput (should sustain >100 events/sec)
   - PTY buffer management (no unbounded growth)
   - File descriptor cleanup (no leaked fds after agent exit)
   - Timeout correctness (silence detection, idle debounce)

### Phase 5: Website Deploy & Final

1. **website-developer**: Deploy `landing/` to production server
2. **All reviewers**: Final pass on complete codebase
3. Verify `npm pack` produces installable package
4. Verify all `bin` commands work after global install

---

## 6. Quality Gates

| Gate | Criteria | Blocker For |
|------|----------|-------------|
| **G1** | Architecture design in plan.md approved | Phase 2 implementation |
| **G2** | All module unit tests pass, >80% coverage | Phase 4 integration |
| **G3** | Code review: no critical issues, TS strict clean | Phase 4 |
| **G4** | Security review: no injection/traversal/credential issues | Phase 4 |
| **G5** | Integration tests pass (all E2E scenarios) | Phase 5 |
| **G6** | Performance review: no leaks, acceptable throughput | Phase 5 |
| **G7** | Website deployed and accessible at server IP | Final delivery |

---

## 7. Testing Strategy

### 7.1 Unit Testing Approach

**Framework**: Vitest (native ESM, fast, Jest-compatible API)

**Mocking strategy**:
- Mock `node-pty` for PTY tests (avoid spawning real processes)
- Mock `fs` operations for bus/store tests (use temp directories)
- Mock `net` for IPC server tests
- Use real file system for JSONL append/read tests (temp dirs)
- Mock engine CLIs for loop tests (return canned output)

**Example test structure**:
```typescript
// test/unit/core/scoring.test.ts
import { describe, it, expect } from "vitest";
import { evaluateReview } from "../../../src/core/scoring.js";

describe("evaluateReview", () => {
  it("approves when score meets threshold", () => {
    const result = evaluateReview(
      { score: 9, issues: [], suggestions: [], approved: false },
      { threshold: 9, requireExplicitApproval: false }
    );
    expect(result.approved).toBe(true);
  });

  it("rejects when score below threshold", () => {
    const result = evaluateReview(
      { score: 7, issues: ["bug"], suggestions: [], approved: false },
      { threshold: 9, requireExplicitApproval: false }
    );
    expect(result.approved).toBe(false);
  });
});
```

### 7.2 Integration Testing Approach

**Strategy**: Spawn real loop processes, mock engine CLIs with simple scripts.

**Mock engines**: Shell scripts that return canned responses:
```bash
#!/bin/bash
# test/fixtures/mock-claude.sh
echo "I've created the REST API with Express..."
echo "Files changed: src/app.ts, src/routes.ts"
```

**E2E flow test**:
1. Start daemon
2. Register mock agents
3. Send task via CLI
4. Verify bus events are written
5. Verify iteration completes
6. Verify plan file updated
7. Stop daemon
8. Verify clean shutdown

### 7.3 Coverage Targets

| Module | Target | Rationale |
|--------|--------|-----------|
| `src/core/` | >90% | Core logic must be thoroughly tested |
| `src/bus/` | >85% | Data integrity critical |
| `src/agent/` | >75% | PTY mocking is complex |
| `src/orchestrator/` | >80% | Daemon reliability matters |
| `src/plan/` | >90% | Simple data operations, easy to test |
| `src/skills/` | >85% | File discovery has edge cases |
| `src/terminal/` | >70% | Adapter-specific behavior hard to mock |
| `src/config/` | >90% | Validation must be correct |
| `src/utils/` | >95% | Foundational, must be rock solid |
| **Overall** | **>80%** | |

---

## 8. Website & Deployment

### 8.1 Landing Page Design

**Reference**: ufoo's `landing/` — dark theme, terminal aesthetic, JetBrains Mono.

**Sections**:

1. **Hero**: "loop" gradient text, tagline "Iterative Multi-Engine AI Orchestration", quick install command
2. **Features**: 6 cards — Multi-Engine, Iteration Loop, Event Bus, Skills, Dashboard, Terminal Adapters
3. **Quick Start**: Installation + usage examples with syntax-highlighted code blocks
4. **How It Works**: ASCII/SVG architecture diagram showing executor→reviewer→score flow
5. **Comparison Table**: loop vs using Claude/Gemini/Codex individually
6. **Footer**: GitHub link, version, license

**Tech stack**: Static HTML + CSS + minimal JS. No framework needed.

**Design tokens**:
- Background: `#0a0a0a`
- Text: `#e0e0e0`
- Accent gradient: `#F07623 → #4285F4 → #10A37F` (Claude→Gemini→Codex)
- Font: JetBrains Mono (monospace), Inter (sans-serif for body)
- Code blocks: Dark terminal style with line numbers

### 8.2 Deployment

**Server**: `8.141.95.103`
**User**: `root`
**Auth**: SSH password `123321Ufo.`

**Deployment steps**:
1. SSH into server
2. Detect web server (nginx/apache) and web root
3. Upload `landing/` contents to web root
4. Verify HTTP access

---

## 9. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| PTY merge complexity (iterloop + ufoo patterns) | High | Medium | Define clear interface first; iterloop's EventEmitter as base, ufoo features as opt-in methods |
| ufoo daemon is 65KB+ JS — TS rewrite scope | High | High | Simplify aggressively; only port core lifecycle + IPC, defer advanced features |
| node-pty cross-platform issues | Medium | Low | macOS-first; test on darwin only initially |
| blessed TUI compatibility | Medium | Low | Port dashboard last; it's a nice-to-have |
| Circular dependency risk | Medium | Medium | Enforce with `madge --circular` in CI; strict layering |
| Integration test flakiness (PTY timing) | Medium | High | Use generous timeouts; mock engines for determinism |
| Server deployment access | Low | Low | Test SSH connection early |

---

## 10. Appendix: Source Project Analysis

### 10.1 ufoo v1.6.0 Key Metrics

- **Language**: JavaScript (CommonJS)
- **Files**: ~100+ source files
- **Key sizes**: daemon/index.js (~65KB), bus/index.js (~850 lines), agent/launcher.js (~814 lines), chat/ (~34 files)
- **Dependencies**: blessed, chalk, commander, gray-matter, node-pty, ws, xterm-headless
- **Test framework**: Jest 30.2.0

### 10.2 iterloop v0.15 Key Metrics

- **Language**: TypeScript (ESM, strict)
- **Files**: ~13 source files
- **Key sizes**: engine.ts (372 lines), pty-session.ts (338 lines), conversation.ts (244 lines), shared-plan.ts (272 lines), protocol.ts (217 lines)
- **Dependencies**: @clack/prompts, commander, gradient-string, node-pty, strip-ansi
- **Test framework**: None

### 10.3 What We Take From Each

**From iterloop** (primary TypeScript base):
- Engine abstraction (`Engine` interface, factory pattern)
- Iteration loop (`runLoop`, executor→reviewer→approval)
- PTY session (EventEmitter base, output classification)
- Multi-turn conversation (idle detection, keystroke forwarding)
- Structured protocol (`IterloopMessage` → `LoopMessage`)
- Interactive UI (`@clack/prompts` guided setup)
- Banner & colors (gradient rendering, brand colors)
- Output renderer (bordered live display)
- Shared plan coordination (`.iterloop-plan.md` → `.loop-plan.md`)

**From ufoo** (architectural patterns, rewritten in TS):
- File-based event bus (JSONL, queues, offsets, seq locking)
- Daemon architecture (background process, PID, logs)
- IPC server (Unix socket, request/response protocol)
- Agent launcher (registration, PTY setup, inject sockets)
- Terminal adapters (pluggable backends, capability contracts)
- Activity detection (state tracking, ready detection)
- Skills system (SKILL.md discovery, injection)
- Decision tracking (YAML frontmatter docs)
- Chat dashboard (blessed TUI)
- Session reuse (TTY/tmux pane detection)

---

## Dependencies (Final)

```json
{
  "dependencies": {
    "@clack/prompts": "^0.10.0",
    "blessed": "^0.1.81",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "gradient-string": "^3.0.0",
    "gray-matter": "^4.0.3",
    "node-pty": "^1.0.0",
    "strip-ansi": "^7.2.0"
  },
  "devDependencies": {
    "@types/blessed": "^0.1.25",
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

---

*Plan authored for the loop-cli project. Phases 1–3 complete.*

---

## Phase 4: Multi-Dimensional Product Analysis, Polish & Release

> **Goal**: Transform the implemented codebase into a production-quality, easily-installable product through systematic multi-dimensional analysis, automated iteration, and proper release engineering.

### 4.1 Agent Team — Comprehensive Product Analysis Prompt

The following English prompt defines a multi-agent team that analyzes the product from every angle a real user would encounter. Each agent specializes in one dimension and produces actionable findings.

```
PROMPT: Comprehensive Multi-Dimensional Product Analysis Agent Team

You are orchestrating a team of specialized analysis agents to evaluate "loop-cli",
a TypeScript CLI tool for iterative multi-engine AI orchestration. Each agent must
simulate a REAL USER perspective — someone who just discovered this tool and wants
to install, understand, and use it.

═══════════════════════════════════════════════════════════════════
AGENT 1: First-Time User Experience (FTUE) Analyst
═══════════════════════════════════════════════════════════════════
Role: Simulate a developer who just found this tool on GitHub/npm.
Tasks:
  1. Read the README — Is it clear what this tool does in 30 seconds?
  2. Follow installation instructions — Do they work? Any missing steps?
  3. Run `loop --help` — Is the help text clear, organized, complete?
  4. Try the guided setup (`loop` with no args) — Is the interactive flow intuitive?
  5. Attempt a basic loop execution — Does it work out of the box?
  6. Check error messages — Are they helpful when things go wrong?
Output: List of friction points, confusing steps, and missing documentation.
Severity: P0 (blocks usage), P1 (confusing), P2 (minor polish)

═══════════════════════════════════════════════════════════════════
AGENT 2: Visual & Aesthetic Reviewer
═══════════════════════════════════════════════════════════════════
Role: Evaluate all visual elements — terminal UI AND landing page.
Tasks:
  Terminal UI:
    1. Is the ASCII banner attractive and professional?
    2. Are colors consistent with brand palette (orange/blue/green)?
    3. Is the blessed dashboard layout clean and readable?
    4. Does the @clack/prompts flow look polished?
    5. Is spacing, alignment, and typography consistent?
    6. Does it look premium/high-end or cheap/amateur?
  Landing Page (landing/index.html):
    1. First impression — Does it feel modern, polished, premium?
    2. Typography — Font sizes, weights, line-heights appropriate?
    3. Color scheme — Dark theme executed well? Contrast sufficient?
    4. Responsive design — Mobile, tablet, desktop all good?
    5. Animations — Smooth, purposeful, not distracting?
    6. Code blocks — Syntax highlighting readable?
    7. CTA buttons — Clear, clickable, well-positioned?
    8. Overall aesthetic — Does it match Apple/Vercel/Linear quality bar?
Output: Specific visual issues with screenshots/descriptions and fix suggestions.
Rating: 1-10 for each dimension (target: 8+ across all)

═══════════════════════════════════════════════════════════════════
AGENT 3: Code Quality & Build Integrity Auditor
═══════════════════════════════════════════════════════════════════
Role: Verify the project compiles, tests pass, and code quality is high.
Tasks:
  1. Run `npm install` — Any dependency issues?
  2. Run `npm run build` — Does TypeScript compile cleanly? Any warnings?
  3. Run `npm test` — All tests passing? Coverage adequate?
  4. Run `npx tsc --noEmit --strict` — Any type errors?
  5. Check for unused imports, dead code, TODO/FIXME/HACK comments
  6. Verify all bin entries work: `loop`, `lclaude`, `lgemini`, `lcodex`
  7. Check for consistent coding style across all 50+ source files
  8. Verify error handling — no unhandled promise rejections, proper cleanup
Output: Build log, test results, list of code quality issues to fix.

═══════════════════════════════════════════════════════════════════
AGENT 4: Security & Dependency Auditor
═══════════════════════════════════════════════════════════════════
Role: Identify security vulnerabilities and risky patterns.
Tasks:
  1. Run `npm audit` — Any known vulnerabilities?
  2. Check for hardcoded secrets, tokens, or credentials
  3. Review file system operations — path traversal risks?
  4. Review IPC/socket operations — injection risks?
  5. Check child process spawning — command injection risks?
  6. Verify file permissions are appropriate
  7. Check for sensitive data in git history
  8. Review .gitignore completeness
Output: Security findings with severity (Critical/High/Medium/Low)

═══════════════════════════════════════════════════════════════════
AGENT 5: Documentation & README Reviewer
═══════════════════════════════════════════════════════════════════
Role: Ensure documentation is complete, accurate, and helpful.
Tasks:
  1. README.md — Exists? Complete? Has install, usage, examples, API?
  2. --help text for all commands — Consistent format? All options documented?
  3. SKILL.md files — Well-written? Useful for agents?
  4. Code comments — Appropriate level? Not over/under-commented?
  5. CHANGELOG.md — Exists? Follows Keep a Changelog format?
  6. LICENSE — Exists? Correct?
  7. Contributing guide — Present if open-source?
Output: Documentation gaps and suggested content.

═══════════════════════════════════════════════════════════════════
AGENT 6: Packaging & Distribution Analyst
═══════════════════════════════════════════════════════════════════
Role: Ensure the product is easy to install and distribute.
Tasks:
  1. `npm pack` — Does it produce a clean tarball?
  2. Check `files` field in package.json — Only necessary files included?
  3. Verify `bin` entries point to valid, executable files
  4. Test `npm install -g` from packed tarball — Works?
  5. Check package size — Reasonable? No bloat?
  6. Verify shebang lines (#!/usr/bin/env node) on bin files
  7. Test on clean Node.js 18+ environment
  8. GitHub Release asset — tarball downloadable and installable?
Output: Packaging issues and distribution readiness checklist.

═══════════════════════════════════════════════════════════════════
ITERATION PROTOCOL
═══════════════════════════════════════════════════════════════════
Round 1: All 6 agents analyze independently, produce findings
Round 2: Fix all P0/Critical issues, re-run affected agents to verify
Round 3: Fix P1/High issues, polish P2/Medium items
Round 4: Final verification pass — all agents confirm clean state
Exit Criteria: All agents report 8+/10 in their dimension, zero P0/P1 issues
```

### 4.2 Analysis Dimensions Matrix

| Dimension | Agent | Key Metrics | Target |
|-----------|-------|-------------|--------|
| User Experience | FTUE Analyst | Time-to-first-success, friction count | < 5 min, 0 blockers |
| Visual Quality | Aesthetic Reviewer | Design score across 8 sub-dimensions | 8+/10 each |
| Build Integrity | Code Auditor | Compile: clean, Tests: 100% pass, Coverage: 80%+ | All green |
| Security | Security Auditor | 0 Critical/High vulns, 0 hardcoded secrets | All clear |
| Documentation | Doc Reviewer | README complete, --help correct, LICENSE present | All present |
| Distribution | Packaging Analyst | npm install works, tarball clean, bins executable | All pass |

### 4.3 Automated Iteration Workflow

```
┌─────────────────────────┐
│   Round N: Analysis      │
│   (All 6 agents run)     │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│   Triage Findings        │
│   P0 → P1 → P2          │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│   Fix Issues             │
│   (Code changes)         │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│   Re-verify              │
│   (Affected agents only) │
└──────────┬──────────────┘
           │
           ▼
    ┌──────┴──────┐
    │ All clear?  │──No──→ Round N+1
    └──────┬──────┘
           │ Yes
           ▼
┌─────────────────────────┐
│   Release Ready          │
└─────────────────────────┘
```

### 4.4 Packaging Strategy

1. **npm package**: `npm pack` → `loop-cli-0.1.0.tgz`
   - Includes: `dist/`, `skills/`, `README.md`, `LICENSE`
   - Excludes: `src/`, `test/`, `.claude/`, `node_modules/`
2. **GitHub Release**: Tag `v0.1.0`, attach tarball
   - Release notes with features, install instructions, changelog
3. **Install methods**:
   - `npm install -g loop-cli` (after npm publish)
   - `npm install -g ./loop-cli-0.1.0.tgz` (from GitHub Release download)
   - `git clone` + `npm install` + `npm run build` (from source)

### 4.5 GitHub Repository Setup

1. Create public repository on GitHub
2. Push codebase to `main` branch
3. Create `v0.1.0` tag and GitHub Release
4. Attach `loop-cli-0.1.0.tgz` as Release asset
5. Write Release notes:
   - Feature highlights
   - Installation instructions
   - System requirements
   - Known limitations

### 4.6 Website Deployment (8.141.95.103)

1. SSH to server, set up nginx/static file serving
2. Deploy `landing/index.html` as the homepage
3. Update landing page with:
   - GitHub repository link
   - Download/install instructions pointing to GitHub Releases
   - Version badge
4. Ensure HTTPS and proper caching headers

### 4.7 Landing Page Updates

The landing page must be updated to include:
- **GitHub link** in navigation and hero section
- **Install command** (`npm install -g loop-cli`)
- **Download button** linking to latest GitHub Release
- **Version number** badge
- **Star count** badge (if applicable)

---

### 4.8 Execution Checklist

- [ ] Build compiles with zero errors
- [ ] All tests pass
- [ ] README.md is complete and accurate
- [ ] LICENSE file present (MIT)
- [ ] CHANGELOG.md present
- [ ] `npm pack` produces clean tarball
- [ ] All bin entries are executable
- [ ] Landing page is visually polished (8+/10)
- [ ] GitHub repo created and code pushed
- [ ] GitHub Release v0.1.0 created with tarball
- [ ] Landing page deployed to 8.141.95.103
- [ ] Landing page links to GitHub repo
- [ ] No security vulnerabilities (npm audit clean)
- [ ] No hardcoded secrets in codebase

---

*Phase 4 added for product polish, multi-dimensional analysis, and release engineering.*
