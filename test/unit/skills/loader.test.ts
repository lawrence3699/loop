import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills } from "../../../src/skills/loader.js";

describe("discoverSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-skills-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers skills from project SKILLS/ directory", async () => {
    const skillDir = join(tmpDir, "SKILLS", "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: A test skill\n---\n\nDo something useful.\n`,
    );

    const skills = await discoverSkills(tmpDir);
    const found = skills.find((s) => s.name === "my-skill");
    expect(found).toBeDefined();
    expect(found?.description).toBe("A test skill");
    expect(found?.content).toBe("Do something useful.");
    expect(found?.scope).toBe("project");
  });

  it("parses YAML frontmatter for name and description", async () => {
    const skillDir = join(tmpDir, "SKILLS", "parser");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: parser-skill\ndescription: Parses things\n---\n\nContent here.\n`,
    );

    const skills = await discoverSkills(tmpDir);
    const found = skills.find((s) => s.name === "parser-skill");
    expect(found).toBeDefined();
    expect(found?.name).toBe("parser-skill");
    expect(found?.description).toBe("Parses things");
  });

  it("uses directory name as fallback name when frontmatter has no name", async () => {
    const skillDir = join(tmpDir, "SKILLS", "fallback-name");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\ndescription: Some skill\n---\n\nSkill content.\n`,
    );

    const skills = await discoverSkills(tmpDir);
    const found = skills.find((s) => s.name === "fallback-name");
    expect(found).toBeDefined();
  });

  it("returns empty array when SKILLS directory does not exist", async () => {
    const skills = await discoverSkills(tmpDir);
    // May return built-in skills but no project skills
    const projectSkills = skills.filter((s) => s.scope === "project");
    expect(projectSkills).toEqual([]);
  });

  it("ignores non-directory entries in SKILLS/", async () => {
    const skillsDir = join(tmpDir, "SKILLS");
    mkdirSync(skillsDir, { recursive: true });
    // Create a file (not a directory) in SKILLS/
    writeFileSync(join(skillsDir, "not-a-skill.md"), "just a file");

    const skills = await discoverSkills(tmpDir);
    const projectSkills = skills.filter((s) => s.scope === "project");
    expect(projectSkills).toEqual([]);
  });

  it("ignores directories without SKILL.md", async () => {
    const skillDir = join(tmpDir, "SKILLS", "no-skill-file");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "README.md"), "Not a skill file");

    const skills = await discoverSkills(tmpDir);
    const found = skills.find((s) => s.name === "no-skill-file");
    expect(found).toBeUndefined();
  });

  it("discovers multiple skills", async () => {
    for (const name of ["skill-a", "skill-b", "skill-c"]) {
      const dir = join(tmpDir, "SKILLS", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Skill ${name}\n---\n\nContent for ${name}.\n`,
      );
    }

    const skills = await discoverSkills(tmpDir);
    const projectSkills = skills.filter((s) => s.scope === "project");
    expect(projectSkills).toHaveLength(3);
    expect(projectSkills.map((s) => s.name).sort()).toEqual([
      "skill-a",
      "skill-b",
      "skill-c",
    ]);
  });
});
