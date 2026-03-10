import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";

// ── Interfaces ──────────────────────────────────────

export interface Decision {
  id: number;
  title: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
  context: string;
  decision: string;
  consequences: string;
  date: string;
}

type DecisionStatus = Decision["status"];

// ── Helpers ─────────────────────────────────────────

function decisionsDir(cwd: string): string {
  return join(cwd, ".loop", "context", "decisions");
}

function slugify(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return cleaned || "decision";
}

function nextNumber(dir: string): number {
  if (!existsSync(dir)) return 1;

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const numbers = files.map((f) => {
    const match = f.match(/^(\d{4})-/);
    return match ? parseInt(match[1], 10) : 0;
  });

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function padId(id: number): string {
  return String(id).padStart(4, "0");
}

function isValidStatus(s: unknown): s is DecisionStatus {
  return s === "proposed" || s === "accepted" || s === "rejected" || s === "superseded";
}

function parseDecisionFile(filePath: string): Decision | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    // Extract ID from filename
    const filename = filePath.split("/").pop() ?? "";
    const idMatch = filename.match(/^(\d{4})-/);
    const id = idMatch ? parseInt(idMatch[1], 10) : 0;

    // Extract title from first heading
    let title = "";
    const titleMatch = body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].replace(/^DECISION\s+\d+:\s*/i, "").trim();
    }

    // Extract sections from body
    const contextMatch = body.match(/Context:\n([\s\S]*?)(?=\nDecision:|\n#|$)/i);
    const decisionMatch = body.match(/Decision:\n([\s\S]*?)(?=\nConsequences:|\nImplications:|\n#|$)/i);
    const consequencesMatch = body.match(/(?:Consequences|Implications):\n([\s\S]*?)(?=\n#|$)/i);

    const status = isValidStatus(data.status) ? data.status : "proposed";
    const date = typeof data.date === "string"
      ? data.date
      : (body.match(/Date:\s*(.+)/)?.[1]?.trim() ?? new Date().toISOString().slice(0, 10));

    return {
      id,
      title: title || (typeof data.title === "string" ? data.title : "(no title)"),
      status,
      context: contextMatch?.[1]?.trim() ?? "",
      decision: decisionMatch?.[1]?.trim() ?? "",
      consequences: consequencesMatch?.[1]?.trim() ?? "",
      date,
    };
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────

/** Add a new decision to the decisions directory. */
export async function addDecision(
  cwd: string,
  decision: Omit<Decision, "id" | "date">,
): Promise<Decision> {
  const dir = decisionsDir(cwd);
  mkdirSync(dir, { recursive: true });

  const id = nextNumber(dir);
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(decision.title);
  const filename = `${padId(id)}-${slug}.md`;
  const filePath = join(dir, filename);

  // Path traversal guard: ensure file stays within decisions dir
  if (!resolve(filePath).startsWith(resolve(dir))) {
    throw new Error("Invalid decision title: path traversal detected");
  }

  const content =
    `---\n` +
    `status: ${decision.status}\n` +
    `date: ${date}\n` +
    `---\n` +
    `# DECISION ${padId(id)}: ${decision.title}\n\n` +
    `Date: ${date}\n\n` +
    `Context:\n${decision.context || "What led to this decision?"}\n\n` +
    `Decision:\n${decision.decision || "What is now considered true?"}\n\n` +
    `Consequences:\n${decision.consequences || "What must follow from this?"}\n`;

  writeFileSync(filePath, content, "utf-8");

  return {
    id,
    title: decision.title,
    status: decision.status,
    context: decision.context,
    decision: decision.decision,
    consequences: decision.consequences,
    date,
  };
}

/** List all decisions from the decisions directory. */
export async function listDecisions(cwd: string): Promise<Decision[]> {
  const dir = decisionsDir(cwd);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const decisions: Decision[] = [];
  for (const file of files) {
    const filePath = join(dir, file);
    const decision = parseDecisionFile(filePath);
    if (decision) {
      decisions.push(decision);
    }
  }

  return decisions;
}

/** Resolve (update status of) a decision by ID. */
export async function resolveDecision(
  cwd: string,
  id: number,
  status: DecisionStatus,
): Promise<void> {
  const dir = decisionsDir(cwd);
  if (!existsSync(dir)) {
    throw new Error(`Decisions directory not found: ${dir}`);
  }

  const prefix = padId(id);
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".md"));

  if (files.length === 0) {
    throw new Error(`Decision ${id} not found`);
  }

  const filePath = join(dir, files[0]);
  const content = readFileSync(filePath, "utf-8");
  const parsed = matter(content);

  // Update status in frontmatter
  const data = parsed.data as Record<string, unknown>;
  data.status = status;
  data.resolved_at = new Date().toISOString();

  const updated = matter.stringify(parsed.content, data);
  writeFileSync(filePath, updated, "utf-8");
}
