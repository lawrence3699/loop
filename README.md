# loop

> Iterative Multi-Engine AI Orchestration CLI

Combine **Claude**, **Gemini**, and **Codex** in a quality-scored iteration loop. One engine executes, another reviews. Repeat until perfect.

```
npm install -g loop-cli
```

## What It Does

```
┌─────────────┐     ┌─────────────┐
│   Executor   │────▶│   Reviewer   │
│  (Claude)    │◀────│  (Gemini)    │
└─────────────┘     └─────────────┘
       │                    │
       │    Score < 8?      │
       │◀───Feedback────────│
       │                    │
       │    Score ≥ 8?      │
       │────APPROVED───────▶│
```

You give it a task. The **executor** engine produces output. The **reviewer** engine scores it (1-10) and provides feedback. If the score doesn't meet the threshold, the feedback is fed back to the executor. This continues until the output is approved or max iterations are reached.

## Quick Start

```bash
# Interactive guided setup
loop

# Direct execution
loop "Refactor the auth module to use JWT" -e claude -r gemini

# Auto mode with custom threshold
loop "Write comprehensive tests for utils/" -e gemini -r claude --auto --threshold 9

# Pass flags to the executor CLI
loop "Build the API endpoints" -e claude --pass --model opus
```

## Features

- **Multi-engine**: Claude CLI, Gemini CLI, Codex CLI — mix and match
- **Quality-scored iteration**: Automatic review loop with configurable threshold (1-10)
- **File-based event bus**: Append-only JSONL, crash-safe, zero external dependencies
- **Multi-agent orchestration**: Background daemon with IPC for coordinating agent teams
- **Skills system**: Executable markdown (`SKILL.md`) auto-injected into agent prompts
- **Interactive TUI**: Beautiful guided setup + real-time monitoring dashboard
- **Terminal adapters**: Terminal.app, iTerm2, tmux, built-in PTY
- **Decision tracking**: Architectural decisions persisted across sessions
- **Local-first**: Everything runs on your machine. No cloud services, no databases.

## Commands

```bash
loop [task]              # Run iteration loop (interactive if no task)
loop daemon start        # Start background daemon
loop daemon stop         # Stop daemon
loop daemon status       # Check daemon status
loop bus tail            # Stream event bus
loop bus stats           # Show bus statistics
loop chat                # Open real-time dashboard
loop plan show           # Show current iteration plan
loop plan clear          # Clear plan
loop ctx add             # Add architectural decision
loop ctx list            # List decisions
loop skills list         # List available skills
loop skills show <name>  # Show skill content
```

## Options

| Flag | Description |
|------|-------------|
| `-e, --executor <engine>` | Executor engine: `claude` \| `gemini` \| `codex` |
| `-r, --reviewer <engine>` | Reviewer engine: `claude` \| `gemini` \| `codex` |
| `-n, --iterations <num>` | Max iterations (default: 5) |
| `-d, --dir <path>` | Working directory |
| `-v, --verbose` | Stream real-time output |
| `--auto` | Auto mode — skip manual conversation |
| `--pass <args...>` | Pass native flags to executor CLI |
| `--threshold <num>` | Approval score threshold, 1-10 (default: 8) |

## How It Works

1. **Configuration**: Reads `.loop/config.json` from your project (or uses defaults)
2. **Engine selection**: Picks executor + reviewer from config or CLI flags
3. **Iteration loop**:
   - Executor receives the task (with prior feedback, if any)
   - Executor produces output via PTY-based CLI session
   - Output is sent to the reviewer with the LoopMessage v1 protocol
   - Reviewer scores (1-10) and provides structured feedback
   - If score meets threshold or "APPROVED" keyword: done
   - Otherwise: feedback → executor → next iteration
4. **Event bus**: All messages logged to append-only JSONL for crash recovery
5. **Skills**: Relevant `SKILL.md` files injected into agent prompts for context

## Configuration

Create `.loop/config.json` in your project:

```json
{
  "executor": "claude",
  "reviewer": "gemini",
  "maxIterations": 5,
  "threshold": 8,
  "verbose": false,
  "auto": false
}
```

## Requirements

- Node.js 18+
- At least one AI CLI tool installed:
  - [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Codex CLI](https://github.com/openai/codex)

## Install from Source

```bash
git clone https://github.com/nicepkg/loop.git
cd loop
npm install
npm run build
npm link
```

## License

MIT
