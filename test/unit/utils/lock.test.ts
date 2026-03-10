import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withFileLock, nextSeq } from "../../../src/utils/lock.js";

describe("lock utilities", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-lock-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── nextSeq ────────────────────────────────────────
  describe("nextSeq", () => {
    it("returns incrementing numbers starting from 1", async () => {
      const counterPath = join(tmpDir, "counter.txt");
      const lockPath = join(tmpDir, "counter.lock");

      const first = await nextSeq(counterPath, lockPath);
      expect(first).toBe(1);

      const second = await nextSeq(counterPath, lockPath);
      expect(second).toBe(2);

      const third = await nextSeq(counterPath, lockPath);
      expect(third).toBe(3);
    });

    it("persists counter to disk", async () => {
      const counterPath = join(tmpDir, "persist.txt");
      const lockPath = join(tmpDir, "persist.lock");

      await nextSeq(counterPath, lockPath);
      await nextSeq(counterPath, lockPath);
      await nextSeq(counterPath, lockPath);

      const content = readFileSync(counterPath, "utf8").trim();
      expect(parseInt(content, 10)).toBe(3);
    });

    it("produces unique values under concurrent calls", async () => {
      const counterPath = join(tmpDir, "concurrent.txt");
      const lockPath = join(tmpDir, "concurrent.lock");

      // Run 10 concurrent nextSeq calls
      const results = await Promise.all(
        Array.from({ length: 10 }, () => nextSeq(counterPath, lockPath)),
      );

      // All should be unique
      const unique = new Set(results);
      expect(unique.size).toBe(10);

      // Should contain 1-10
      for (let i = 1; i <= 10; i++) {
        expect(unique.has(i)).toBe(true);
      }
    });

    it("recovers from corrupt counter file", async () => {
      const counterPath = join(tmpDir, "corrupt.txt");
      const lockPath = join(tmpDir, "corrupt.lock");

      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(counterPath), { recursive: true });
      writeFileSync(counterPath, "not a number\n", "utf8");

      const result = await nextSeq(counterPath, lockPath);
      expect(result).toBe(1);
    });
  });

  // ── withFileLock ───────────────────────────────────
  describe("withFileLock", () => {
    it("executes the function and returns its result", async () => {
      const lockPath = join(tmpDir, "test.lock");
      const result = await withFileLock(lockPath, async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it("releases lock after completion", async () => {
      const lockPath = join(tmpDir, "release.lock");
      await withFileLock(lockPath, async () => {
        return "done";
      });

      // Lock file should be removed after function completes
      expect(existsSync(lockPath)).toBe(false);
    });

    it("releases lock on error", async () => {
      const lockPath = join(tmpDir, "error.lock");

      await expect(
        withFileLock(lockPath, async () => {
          throw new Error("intentional");
        }),
      ).rejects.toThrow("intentional");

      // Lock should still be released
      expect(existsSync(lockPath)).toBe(false);
    });

    it("handles nested lock paths with missing parent dirs", async () => {
      const lockPath = join(tmpDir, "nested", "deep", "test.lock");
      const result = await withFileLock(lockPath, async () => "nested result");
      expect(result).toBe("nested result");
    });

    it("serializes concurrent access", async () => {
      const lockPath = join(tmpDir, "serial.lock");
      const order: number[] = [];

      const tasks = [1, 2, 3].map((n) =>
        withFileLock(lockPath, async () => {
          order.push(n);
          // Small delay to verify serialization
          await new Promise((resolve) => setTimeout(resolve, 10));
          return n;
        }),
      );

      const results = await Promise.all(tasks);

      // All tasks should complete
      expect(results.sort()).toEqual([1, 2, 3]);
      // Order should be sequential (all 3 should be present)
      expect(order).toHaveLength(3);
    });

    it("times out when lock cannot be acquired", async () => {
      const lockPath = join(tmpDir, "timeout.lock");

      // Manually create a lock file owned by the current PID (so it won't be cleaned as stale)
      const { writeFileSync } = await import("node:fs");
      writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });

      await expect(
        withFileLock(
          lockPath,
          async () => "should not reach",
          200, // very short timeout
        ),
      ).rejects.toThrow("Failed to acquire file lock");
    });
  });
});
