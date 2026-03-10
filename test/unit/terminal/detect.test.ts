import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectTerminal, detectTmuxPane } from "../../../src/terminal/detect.js";

describe("detectTerminal", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear relevant env vars
    for (const key of [
      "LOOP_LAUNCH_MODE",
      "TMUX_PANE",
      "ITERM_SESSION_ID",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns 'tmux' when TMUX_PANE is set", () => {
    process.env.TMUX_PANE = "%0";
    expect(detectTerminal()).toBe("tmux");
  });

  it("returns 'iterm2' when ITERM_SESSION_ID is set", () => {
    process.env.ITERM_SESSION_ID = "abc-123";
    expect(detectTerminal()).toBe("iterm2");
  });

  it("returns 'pty' as fallback when no env vars set", () => {
    expect(detectTerminal()).toBe("pty");
  });

  it("prefers TMUX_PANE over ITERM_SESSION_ID", () => {
    process.env.TMUX_PANE = "%1";
    process.env.ITERM_SESSION_ID = "abc-123";
    expect(detectTerminal()).toBe("tmux");
  });

  it("respects LOOP_LAUNCH_MODE override", () => {
    process.env.LOOP_LAUNCH_MODE = "terminal";
    process.env.TMUX_PANE = "%0";
    expect(detectTerminal()).toBe("terminal");
  });

  it("respects LOOP_LAUNCH_MODE=tmux override", () => {
    process.env.LOOP_LAUNCH_MODE = "tmux";
    expect(detectTerminal()).toBe("tmux");
  });

  it("respects LOOP_LAUNCH_MODE=iterm2 override", () => {
    process.env.LOOP_LAUNCH_MODE = "iterm2";
    expect(detectTerminal()).toBe("iterm2");
  });

  it("respects LOOP_LAUNCH_MODE=pty override", () => {
    process.env.LOOP_LAUNCH_MODE = "pty";
    process.env.TMUX_PANE = "%0"; // Would normally return tmux
    expect(detectTerminal()).toBe("pty");
  });

  it("ignores invalid LOOP_LAUNCH_MODE", () => {
    process.env.LOOP_LAUNCH_MODE = "kubernetes";
    expect(detectTerminal()).toBe("pty");
  });

  it("trims whitespace from LOOP_LAUNCH_MODE", () => {
    process.env.LOOP_LAUNCH_MODE = "  terminal  ";
    expect(detectTerminal()).toBe("terminal");
  });

  it("is case-insensitive for LOOP_LAUNCH_MODE", () => {
    process.env.LOOP_LAUNCH_MODE = "TMUX";
    expect(detectTerminal()).toBe("tmux");
  });
});

describe("detectTmuxPane", () => {
  const savedPane = process.env.TMUX_PANE;

  afterEach(() => {
    if (savedPane === undefined) {
      delete process.env.TMUX_PANE;
    } else {
      process.env.TMUX_PANE = savedPane;
    }
  });

  it("returns pane identifier when TMUX_PANE is set", () => {
    process.env.TMUX_PANE = "%0";
    expect(detectTmuxPane()).toBe("%0");
  });

  it("returns undefined when TMUX_PANE is not set", () => {
    delete process.env.TMUX_PANE;
    expect(detectTmuxPane()).toBeUndefined();
  });

  it("returns undefined when TMUX_PANE is empty", () => {
    process.env.TMUX_PANE = "";
    expect(detectTmuxPane()).toBeUndefined();
  });

  it("trims whitespace from TMUX_PANE", () => {
    process.env.TMUX_PANE = "  %1  ";
    expect(detectTmuxPane()).toBe("%1");
  });
});
