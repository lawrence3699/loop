import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { type Skill, discoverSkills } from "./loader.js";

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Load/reload all discoverable skills. */
  async load(cwd: string): Promise<void> {
    this.skills.clear();
    const discovered = await discoverSkills(cwd);
    for (const skill of discovered) {
      this.skills.set(skill.name, skill);
    }
  }

  /** Get a single skill by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** List all loaded skills. */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Add a new skill (write SKILL.md to disk). */
  async add(
    name: string,
    content: string,
    scope: "global" | "project",
    cwd?: string,
  ): Promise<void> {
    // Prevent path traversal
    if (/[/\\]|^\.\.?$/.test(name) || name.includes("..")) {
      throw new Error(`Invalid skill name: ${name}`);
    }

    let baseDir: string;

    if (scope === "global") {
      baseDir = join(homedir(), ".loop", "skills");
    } else {
      if (!cwd) {
        throw new Error("cwd is required when adding a project-scoped skill");
      }
      baseDir = join(cwd, "SKILLS");
    }

    const skillDir = join(baseDir, name);
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, "SKILL.md");
    const fileContent =
      `---\nname: ${name}\ndescription: ""\n---\n\n${content}\n`;
    writeFileSync(skillPath, fileContent, "utf-8");

    // Register in memory
    this.skills.set(name, {
      name,
      description: "",
      content,
      path: skillPath,
      scope,
    });
  }
}
