# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-10

### Added

- Iterative execution loop: executor produces output, reviewer scores (1-10), feedback fed back until approved
- Multi-engine support: Claude CLI, Gemini CLI, Codex CLI via unified `Engine` interface
- File-based event bus: append-only JSONL event streaming, crash-safe, zero external dependencies
- Background daemon: agent lifecycle management with Unix domain socket IPC
- Agent wrappers: `lclaude`, `lgemini`, `lcodex` — transforms CLI agents into loop participants
- Skills system: executable markdown (SKILL.md) auto-injected into agent prompts
- Interactive TUI: `@clack/prompts` guided setup + `blessed` real-time monitoring dashboard
- Terminal adapters: pluggable backends for Terminal.app, iTerm2, tmux, PTY emulation
- Shared plan management: cross-session iteration context with architectural decision tracking
- Configuration cascade: project-level `.loop/config.json` with sensible defaults
- 282 tests across 23 test files with full pass rate
