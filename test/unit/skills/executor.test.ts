import { describe, it, expect } from "vitest";
import { injectSkills } from "../../../src/skills/executor.js";
import type { Skill } from "../../../src/skills/loader.js";

function makeSkill(name: string, content: string): Skill {
  return {
    name,
    description: `Skill: ${name}`,
    content,
    path: `/fake/path/${name}/SKILL.md`,
    scope: "project",
  };
}

describe("injectSkills", () => {
  it("returns prompt unchanged when no skills", () => {
    const prompt = "Do the thing";
    expect(injectSkills(prompt, [])).toBe("Do the thing");
  });

  it("prepends single skill with delimiters", () => {
    const skills = [makeSkill("test-skill", "Skill instructions here")];
    const result = injectSkills("Main prompt", skills);

    expect(result).toContain("--- SKILL: test-skill ---");
    expect(result).toContain("Skill instructions here");
    expect(result).toContain("--- END SKILL ---");
    expect(result).toContain("Main prompt");
    // Skill should come before prompt
    const skillIdx = result.indexOf("--- SKILL: test-skill ---");
    const promptIdx = result.indexOf("Main prompt");
    expect(skillIdx).toBeLessThan(promptIdx);
  });

  it("injects multiple skills in order", () => {
    const skills = [
      makeSkill("first", "First skill content"),
      makeSkill("second", "Second skill content"),
      makeSkill("third", "Third skill content"),
    ];

    const result = injectSkills("Main prompt", skills);

    expect(result).toContain("--- SKILL: first ---");
    expect(result).toContain("--- SKILL: second ---");
    expect(result).toContain("--- SKILL: third ---");

    // Verify order
    const firstIdx = result.indexOf("--- SKILL: first ---");
    const secondIdx = result.indexOf("--- SKILL: second ---");
    const thirdIdx = result.indexOf("--- SKILL: third ---");
    const promptIdx = result.indexOf("Main prompt");

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
    expect(thirdIdx).toBeLessThan(promptIdx);
  });

  it("separates skills with double newlines", () => {
    const skills = [
      makeSkill("a", "Content A"),
      makeSkill("b", "Content B"),
    ];

    const result = injectSkills("prompt", skills);
    expect(result).toContain("--- END SKILL ---\n\n--- SKILL: b ---");
  });

  it("separates skills from prompt with double newline", () => {
    const skills = [makeSkill("s", "content")];
    const result = injectSkills("prompt", skills);
    expect(result).toContain("--- END SKILL ---\n\nprompt");
  });
});
