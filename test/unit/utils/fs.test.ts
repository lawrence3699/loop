import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureDir,
  appendJsonl,
  readJsonl,
  safeWriteFile,
  safeReadFile,
  fileExists,
  truncateFile,
  readLastLine,
} from "../../../src/utils/fs.js";

describe("fs utilities", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-fs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ensureDir ──────────────────────────────────────
  describe("ensureDir", () => {
    it("creates nested directories", async () => {
      const nested = join(tmpDir, "a", "b", "c");
      await ensureDir(nested);
      expect(await fileExists(nested)).toBe(true);
    });

    it("is idempotent for existing directories", async () => {
      const dir = join(tmpDir, "existing");
      await ensureDir(dir);
      await ensureDir(dir); // should not throw
      expect(await fileExists(dir)).toBe(true);
    });
  });

  // ── appendJsonl / readJsonl ────────────────────────
  describe("appendJsonl / readJsonl", () => {
    it("appends and reads back JSON lines", async () => {
      const filePath = join(tmpDir, "data.jsonl");
      await appendJsonl(filePath, { a: 1 });
      await appendJsonl(filePath, { b: 2 });

      const data = await readJsonl<{ a?: number; b?: number }>(filePath);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ a: 1 });
      expect(data[1]).toEqual({ b: 2 });
    });

    it("readJsonl returns empty array for missing file", async () => {
      const filePath = join(tmpDir, "nonexistent.jsonl");
      const data = await readJsonl(filePath);
      expect(data).toEqual([]);
    });

    it("readJsonl skips malformed lines", async () => {
      const filePath = join(tmpDir, "mixed.jsonl");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(filePath, '{"good":true}\nnot json\n{"also":"good"}\n', "utf8");

      const data = await readJsonl<Record<string, unknown>>(filePath);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ good: true });
      expect(data[1]).toEqual({ also: "good" });
    });

    it("creates parent directories automatically", async () => {
      const filePath = join(tmpDir, "nested", "deep", "data.jsonl");
      await appendJsonl(filePath, { x: 42 });

      const data = await readJsonl<{ x: number }>(filePath);
      expect(data).toEqual([{ x: 42 }]);
    });
  });

  // ── safeWriteFile / safeReadFile ───────────────────
  describe("safeWriteFile / safeReadFile", () => {
    it("writes atomically and reads back", async () => {
      const filePath = join(tmpDir, "safe.txt");
      await safeWriteFile(filePath, "hello world");

      const content = await safeReadFile(filePath);
      expect(content).toBe("hello world");
    });

    it("creates parent directories", async () => {
      const filePath = join(tmpDir, "deep", "nested", "safe.txt");
      await safeWriteFile(filePath, "deep write");

      const content = await safeReadFile(filePath);
      expect(content).toBe("deep write");
    });

    it("safeReadFile returns null for missing file", async () => {
      const content = await safeReadFile(join(tmpDir, "no-file.txt"));
      expect(content).toBeNull();
    });

    it("overwrites existing file", async () => {
      const filePath = join(tmpDir, "overwrite.txt");
      await safeWriteFile(filePath, "first");
      await safeWriteFile(filePath, "second");

      const content = await safeReadFile(filePath);
      expect(content).toBe("second");
    });
  });

  // ── fileExists ─────────────────────────────────────
  describe("fileExists", () => {
    it("returns true for existing file", async () => {
      const filePath = join(tmpDir, "exists.txt");
      await safeWriteFile(filePath, "content");
      expect(await fileExists(filePath)).toBe(true);
    });

    it("returns false for non-existing file", async () => {
      expect(await fileExists(join(tmpDir, "nope.txt"))).toBe(false);
    });

    it("returns true for existing directory", async () => {
      expect(await fileExists(tmpDir)).toBe(true);
    });
  });

  // ── truncateFile ───────────────────────────────────
  describe("truncateFile", () => {
    it("truncates file to empty", async () => {
      const filePath = join(tmpDir, "trunc.txt");
      await safeWriteFile(filePath, "some content");
      await truncateFile(filePath);

      const content = await readFile(filePath, "utf8");
      expect(content).toBe("");
    });

    it("creates file if it does not exist", async () => {
      const filePath = join(tmpDir, "new-trunc.txt");
      await truncateFile(filePath);

      const content = await readFile(filePath, "utf8");
      expect(content).toBe("");
    });
  });

  // ── readLastLine ───────────────────────────────────
  describe("readLastLine", () => {
    it("reads the last non-empty line", async () => {
      const filePath = join(tmpDir, "lines.txt");
      await safeWriteFile(filePath, "line1\nline2\nline3\n");

      const last = await readLastLine(filePath);
      expect(last).toBe("line3");
    });

    it("returns null for missing file", async () => {
      const last = await readLastLine(join(tmpDir, "missing.txt"));
      expect(last).toBeNull();
    });

    it("returns null for empty file", async () => {
      const filePath = join(tmpDir, "empty.txt");
      await safeWriteFile(filePath, "");

      const last = await readLastLine(filePath);
      expect(last).toBeNull();
    });
  });
});
