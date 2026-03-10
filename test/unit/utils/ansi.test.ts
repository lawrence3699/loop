import { describe, it, expect } from "vitest";
import { stripAnsi, isAnsiOnly } from "../../../src/utils/ansi.js";

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    const input = "\x1b[31mRed text\x1b[0m";
    expect(stripAnsi(input)).toBe("Red text");
  });

  it("removes multiple ANSI sequences", () => {
    const input = "\x1b[1m\x1b[34mBold Blue\x1b[0m";
    expect(stripAnsi(input)).toBe("Bold Blue");
  });

  it("preserves plain text without ANSI codes", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("removes cursor movement codes", () => {
    const input = "\x1b[2J\x1b[HHello";
    expect(stripAnsi(input)).toBe("Hello");
  });

  it("strips SGR (Select Graphic Rendition) sequences", () => {
    const input = "\x1b[38;5;196mColor\x1b[0m";
    expect(stripAnsi(input)).toBe("Color");
  });
});

describe("isAnsiOnly", () => {
  it("returns true for ANSI-only strings", () => {
    expect(isAnsiOnly("\x1b[31m\x1b[0m")).toBe(true);
  });

  it("returns true for complex ANSI-only strings", () => {
    expect(isAnsiOnly("\x1b[2J\x1b[H\x1b[?25h")).toBe(true);
  });

  it("returns false for strings with text content", () => {
    expect(isAnsiOnly("\x1b[31mHello\x1b[0m")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isAnsiOnly("hello")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAnsiOnly("")).toBe(false);
  });
});
