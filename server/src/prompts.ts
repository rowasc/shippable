import path from "node:path";
import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import * as library from "./library.ts";

const ArgSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional().default(false),
  // Frontend-interpreted hint for pre-fill: "selection", "file",
  // "changeset.title", "changeset.diff", etc. Server doesn't act on it.
  auto: z.string().optional(),
  description: z.string().optional(),
});

const FrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  args: z.array(ArgSchema).optional().default([]),
});

export type PromptArg = z.infer<typeof ArgSchema>;

export type Prompt = {
  id: string;
  name: string;
  description: string;
  args: PromptArg[];
  body: string;
};

export async function list(): Promise<Prompt[]> {
  const root = await library.root();
  const dir = path.join(root, "prompts");

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const prompts: Prompt[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      prompts.push(parsePrompt(entry, raw));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[server] skipping prompt ${entry}: ${reason}`);
    }
  }
  prompts.sort((a, b) => a.id.localeCompare(b.id));
  return prompts;
}

function parsePrompt(filename: string, raw: string): Prompt {
  const id = filename.replace(/\.md$/, "");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("missing YAML frontmatter delimited by --- ... ---");
  }
  const [, frontmatterRaw, body] = match;
  const fmObj = parseYaml(frontmatterRaw) as unknown;
  const fm = FrontmatterSchema.parse(fmObj);
  return {
    id,
    name: fm.name,
    description: fm.description,
    args: fm.args,
    body: body.replace(/^\r?\n/, ""),
  };
}
