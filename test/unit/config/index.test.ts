import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to mock homedir to control the global config path
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

import { homedir } from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "../../../src/config/index.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-config-test-"));
    homeDir = join(tmpDir, "home");
    projectDir = join(tmpDir, "project");
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Point homedir to our temp dir
    vi.mocked(homedir).mockReturnValue(homeDir);

    // Clear env vars
    delete process.env.LOOP_EXECUTOR;
    delete process.env.LOOP_REVIEWER;
    delete process.env.LOOP_ITERATIONS;
    delete process.env.LOOP_THRESHOLD;
    delete process.env.LOOP_MODE;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();

    // Clean up env vars
    delete process.env.LOOP_EXECUTOR;
    delete process.env.LOOP_REVIEWER;
    delete process.env.LOOP_ITERATIONS;
    delete process.env.LOOP_THRESHOLD;
    delete process.env.LOOP_MODE;
  });

  it("loads defaults when no config files exist", async () => {
    const config = await loadConfig(projectDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("global config overrides defaults", async () => {
    const globalDir = join(homeDir, ".loop");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ defaultExecutor: "gemini", maxIterations: 5 }),
    );

    const config = await loadConfig(projectDir);
    expect(config.defaultExecutor).toBe("gemini");
    expect(config.maxIterations).toBe(5);
    // Others should still be defaults
    expect(config.defaultReviewer).toBe("gemini");
  });

  it("project config overrides global config", async () => {
    // Set global config
    const globalDir = join(homeDir, ".loop");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      join(globalDir, "config.json"),
      JSON.stringify({ defaultExecutor: "gemini", threshold: 7 }),
    );

    // Set project config that overrides
    const projectConfigDir = join(projectDir, ".loop");
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(
      join(projectConfigDir, "config.json"),
      JSON.stringify({ defaultExecutor: "codex" }),
    );

    const config = await loadConfig(projectDir);
    // Project overrides global
    expect(config.defaultExecutor).toBe("codex");
    // Global still applies for non-overridden
    expect(config.threshold).toBe(7);
  });

  it("env vars override file config", async () => {
    // Set file config
    const projectConfigDir = join(projectDir, ".loop");
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(
      join(projectConfigDir, "config.json"),
      JSON.stringify({ defaultExecutor: "gemini", threshold: 7 }),
    );

    // Set env vars
    process.env.LOOP_EXECUTOR = "codex";
    process.env.LOOP_THRESHOLD = "5";

    const config = await loadConfig(projectDir);
    expect(config.defaultExecutor).toBe("codex");
    expect(config.threshold).toBe(5);
  });

  it("LOOP_REVIEWER env var works", async () => {
    process.env.LOOP_REVIEWER = "claude";
    const config = await loadConfig(projectDir);
    expect(config.defaultReviewer).toBe("claude");
  });

  it("LOOP_ITERATIONS env var works", async () => {
    process.env.LOOP_ITERATIONS = "10";
    const config = await loadConfig(projectDir);
    expect(config.maxIterations).toBe(10);
  });

  it("LOOP_MODE env var works", async () => {
    process.env.LOOP_MODE = "auto";
    const config = await loadConfig(projectDir);
    expect(config.mode).toBe("auto");
  });

  it("ignores invalid env vars", async () => {
    process.env.LOOP_EXECUTOR = "invalid-engine";
    process.env.LOOP_ITERATIONS = "not-a-number";
    process.env.LOOP_MODE = "turbo";

    const config = await loadConfig(projectDir);
    expect(config.defaultExecutor).toBe(DEFAULT_CONFIG.defaultExecutor);
    expect(config.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
    expect(config.mode).toBe(DEFAULT_CONFIG.mode);
  });

  it("handles malformed JSON in config files gracefully", async () => {
    const globalDir = join(homeDir, ".loop");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "config.json"), "{ not valid json ");

    const config = await loadConfig(projectDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("works without cwd argument", async () => {
    const config = await loadConfig();
    // Should use defaults (no project config loaded)
    expect(config.defaultExecutor).toBeDefined();
  });
});
