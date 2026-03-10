import { describe, it, expect } from "vitest";
import {
  classifyLine,
  filterOutput,
  deduplicateLines,
} from "../../../src/utils/pty-filter.js";

describe("classifyLine", () => {
  // ── ignore cases ───────────────────────────────────
  it("classifies empty string as ignore", () => {
    expect(classifyLine("")).toBe("ignore");
  });

  it("classifies whitespace-only as ignore", () => {
    expect(classifyLine("   ")).toBe("ignore");
  });

  it("classifies box-drawing characters as ignore", () => {
    expect(classifyLine("─────────────────")).toBe("ignore");
    expect(classifyLine("│ box content")).toBe("ignore");
    expect(classifyLine("╭───────╮")).toBe("ignore");
    expect(classifyLine("╰───────╯")).toBe("ignore");
    expect(classifyLine("┌──┐")).toBe("ignore");
  });

  it("classifies spinner chars as ignore", () => {
    expect(classifyLine("⠋⠙⠹⠸")).toBe("ignore");
    expect(classifyLine("  ✳✶✻  ")).toBe("ignore");
  });

  it("classifies short fragments < 5 chars as ignore", () => {
    expect(classifyLine("abc")).toBe("ignore");
    expect(classifyLine("hi")).toBe("ignore");
  });

  it("classifies prompt marker as ignore", () => {
    expect(classifyLine("❯ some prompt")).toBe("ignore");
  });

  it("classifies permission mode indicator as ignore", () => {
    expect(classifyLine("⏵⏵ Auto mode")).toBe("ignore");
  });

  it("classifies update notices as ignore", () => {
    expect(classifyLine("Update available: brew upgrade")).toBe("ignore");
  });

  it("classifies keyboard hints as ignore", () => {
    expect(classifyLine("Press Shift+Tab to switch")).toBe("ignore");
  });

  it("classifies fast mode as ignore", () => {
    expect(classifyLine("Fast mode enabled")).toBe("ignore");
  });

  it("classifies block element art as ignore", () => {
    expect(classifyLine("▐▛▜▝▘█▌")).toBe("ignore");
  });

  it("classifies horizontal rules as ignore", () => {
    expect(classifyLine("═══════════")).toBe("ignore");
  });

  it("classifies status bar pattern as ignore", () => {
    expect(classifyLine("Progress ▪▪▪ running")).toBe("ignore");
  });

  it("classifies truncated UI text as ignore", () => {
    expect(classifyLine("… some truncated text")).toBe("ignore");
  });

  // ── status cases ───────────────────────────────────
  it("classifies status keywords as status", () => {
    expect(classifyLine("Currently thinking about the problem")).toBe("status");
    expect(classifyLine("Analyzing your codebase now")).toBe("status");
    expect(classifyLine("Generating a response for you")).toBe("status");
    expect(classifyLine("Searching through files")).toBe("status");
  });

  it("classifies spinner lines with short text as status", () => {
    expect(classifyLine("● Loading modules")).toBe("status");
    expect(classifyLine("✓ Done compiling")).toBe("status");
  });

  // ── content cases ──────────────────────────────────
  it("classifies Claude content marker with text as content", () => {
    expect(classifyLine("⏺ Here is the answer")).toBe("content");
  });

  it("classifies bare Claude content marker as ignore", () => {
    expect(classifyLine("⏺")).toBe("ignore");
  });

  it("classifies normal text as content", () => {
    expect(classifyLine("This is a normal output line with real content")).toBe("content");
  });

  it("classifies long lines starting with spinner char as content when text is long", () => {
    const longLine =
      "● " +
      "A".repeat(80);
    expect(classifyLine(longLine)).toBe("content");
  });

  // ── engine-specific ────────────────────────────────
  it("classifies non-marker text as ignore for claude engine", () => {
    expect(classifyLine("Some text without marker", "claude")).toBe("ignore");
  });

  it("still classifies Claude content marker as content for claude engine", () => {
    expect(classifyLine("⏺ Claude output here", "claude")).toBe("content");
  });
});

describe("filterOutput", () => {
  it("removes noise lines from output", () => {
    const raw = [
      "⏺ Hello world",
      "─────────",
      "⏺ More output",
      "❯ prompt",
      "⠋⠙⠹",
      "real content line here that should remain",
    ].join("\n");

    const result = filterOutput(raw);

    expect(result).toContain("Hello world");
    expect(result).toContain("More output");
    expect(result).toContain("real content line here that should remain");
    expect(result).not.toContain("─────────");
    expect(result).not.toContain("❯ prompt");
    expect(result).not.toContain("⠋⠙⠹");
  });

  it("strips ⏺ content marker prefix", () => {
    const raw = "⏺ Some Claude output";
    const result = filterOutput(raw);
    expect(result).toBe("Some Claude output");
    expect(result).not.toContain("⏺");
  });

  it("preserves blank lines between content", () => {
    const raw = "⏺ Line one\n\n⏺ Line two";
    const result = filterOutput(raw);
    expect(result).toContain("Line one");
    expect(result).toContain("Line two");
  });

  it("removes status keyword lines (short ones)", () => {
    const raw = "⏺ Real output\nthinking about it\n⏺ More real output";
    const result = filterOutput(raw);
    expect(result).toContain("Real output");
    expect(result).toContain("More real output");
    expect(result).not.toContain("thinking about it");
  });

  it("returns empty string for pure noise input", () => {
    const raw = "─────\n⠋⠙⠹\n❯ >";
    const result = filterOutput(raw);
    expect(result).toBe("");
  });

  it("handles empty input", () => {
    expect(filterOutput("")).toBe("");
  });
});

describe("deduplicateLines", () => {
  it("removes consecutive duplicate lines", () => {
    const lines = ["hello", "hello", "world"];
    expect(deduplicateLines(lines)).toEqual(["hello", "world"]);
  });

  it("preserves non-consecutive duplicates", () => {
    const lines = ["hello", "world", "hello"];
    expect(deduplicateLines(lines)).toEqual(["hello", "world", "hello"]);
  });

  it("ignores whitespace differences when deduplicating", () => {
    const lines = ["hello world", "  hello   world  ", "next"];
    expect(deduplicateLines(lines)).toEqual(["hello world", "next"]);
  });

  it("keeps empty lines (they are not deduplicated)", () => {
    const lines = ["", "", "text", ""];
    expect(deduplicateLines(lines)).toEqual(["", "", "text", ""]);
  });

  it("handles single-element array", () => {
    expect(deduplicateLines(["only"])).toEqual(["only"]);
  });

  it("handles empty array", () => {
    expect(deduplicateLines([])).toEqual([]);
  });
});
