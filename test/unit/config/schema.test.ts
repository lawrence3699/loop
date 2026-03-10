import { describe, it, expect } from "vitest";
import {
  validateConfig,
  DEFAULT_CONFIG,
  ENGINE_NAMES,
  type LoopConfig,
} from "../../../src/config/schema.js";

describe("validateConfig", () => {
  it("returns defaults for null input", () => {
    const config = validateConfig(null);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults for undefined input", () => {
    const config = validateConfig(undefined);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults for non-object input", () => {
    const config = validateConfig("string");
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults for empty object", () => {
    const config = validateConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("accepts valid complete config", () => {
    const raw = {
      defaultExecutor: "gemini",
      defaultReviewer: "codex",
      maxIterations: 5,
      threshold: 7,
      mode: "auto",
      launchMode: "tmux",
      autoResume: true,
      skillsDir: "/custom/skills",
      verbose: true,
    };

    const config = validateConfig(raw);
    expect(config.defaultExecutor).toBe("gemini");
    expect(config.defaultReviewer).toBe("codex");
    expect(config.maxIterations).toBe(5);
    expect(config.threshold).toBe(7);
    expect(config.mode).toBe("auto");
    expect(config.launchMode).toBe("tmux");
    expect(config.autoResume).toBe(true);
    expect(config.skillsDir).toBe("/custom/skills");
    expect(config.verbose).toBe(true);
  });

  // ── engine name validation ─────────────────────────
  it("rejects invalid engine name and uses default", () => {
    const config = validateConfig({ defaultExecutor: "gpt5" });
    expect(config.defaultExecutor).toBe(DEFAULT_CONFIG.defaultExecutor);
  });

  it("accepts all valid engine names", () => {
    for (const name of ENGINE_NAMES) {
      const config = validateConfig({ defaultExecutor: name });
      expect(config.defaultExecutor).toBe(name);
    }
  });

  // ── iteration count validation ─────────────────────
  it("rejects maxIterations below 1", () => {
    const config = validateConfig({ maxIterations: 0 });
    expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
  });

  it("rejects maxIterations above 20", () => {
    const config = validateConfig({ maxIterations: 25 });
    expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
  });

  it("accepts maxIterations at boundary (1)", () => {
    const config = validateConfig({ maxIterations: 1 });
    expect(config.maxIterations).toBe(1);
  });

  it("accepts maxIterations at boundary (20)", () => {
    const config = validateConfig({ maxIterations: 20 });
    expect(config.maxIterations).toBe(20);
  });

  it("rejects non-numeric maxIterations", () => {
    const config = validateConfig({ maxIterations: "five" });
    expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
  });

  // ── threshold validation ───────────────────────────
  it("rejects threshold below 1", () => {
    const config = validateConfig({ threshold: 0 });
    expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
  });

  it("rejects threshold above 10", () => {
    const config = validateConfig({ threshold: 11 });
    expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
  });

  it("accepts threshold at boundaries", () => {
    expect(validateConfig({ threshold: 1 }).threshold).toBe(1);
    expect(validateConfig({ threshold: 10 }).threshold).toBe(10);
  });

  // ── mode validation ────────────────────────────────
  it("rejects invalid mode", () => {
    const config = validateConfig({ mode: "turbo" });
    expect(config.mode).toBe(DEFAULT_CONFIG.mode);
  });

  it("accepts valid modes", () => {
    expect(validateConfig({ mode: "auto" }).mode).toBe("auto");
    expect(validateConfig({ mode: "manual" }).mode).toBe("manual");
  });

  // ── launchMode validation ──────────────────────────
  it("rejects invalid launchMode", () => {
    const config = validateConfig({ launchMode: "kubernetes" });
    expect(config.launchMode).toBe(DEFAULT_CONFIG.launchMode);
  });

  it("accepts all valid launchModes", () => {
    for (const mode of ["terminal", "tmux", "iterm2", "pty", "auto"]) {
      expect(validateConfig({ launchMode: mode }).launchMode).toBe(mode);
    }
  });

  // ── extra fields ───────────────────────────────────
  it("ignores extra fields", () => {
    const config = validateConfig({ extraField: "ignored", anotherOne: 42 });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect((config as Record<string, unknown>).extraField).toBeUndefined();
  });

  // ── partial overrides ──────────────────────────────
  it("fills missing fields with defaults", () => {
    const config = validateConfig({ defaultExecutor: "gemini" });
    expect(config.defaultExecutor).toBe("gemini");
    expect(config.defaultReviewer).toBe(DEFAULT_CONFIG.defaultReviewer);
    expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
    expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_CONFIG.defaultExecutor).toBe("claude");
    expect(DEFAULT_CONFIG.defaultReviewer).toBe("gemini");
    expect(DEFAULT_CONFIG.maxIterations).toBe(3);
    expect(DEFAULT_CONFIG.threshold).toBe(9);
    expect(DEFAULT_CONFIG.mode).toBe("manual");
    expect(DEFAULT_CONFIG.launchMode).toBe("auto");
    expect(DEFAULT_CONFIG.autoResume).toBe(false);
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});

describe("ENGINE_NAMES", () => {
  it("contains all expected engines", () => {
    expect(ENGINE_NAMES).toContain("claude");
    expect(ENGINE_NAMES).toContain("gemini");
    expect(ENGINE_NAMES).toContain("codex");
    expect(ENGINE_NAMES).toHaveLength(3);
  });
});
