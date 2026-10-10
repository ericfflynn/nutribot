import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Runs one structured request through the Claude Code binary (Agent SDK),
// authenticated by CLAUDE_CODE_OAUTH_TOKEN. No built-in tools, no settings,
// no saved sessions: the model reads the prompt and returns JSON matching the schema.

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Claude Code writes config and caches under CLAUDE_CONFIG_DIR. Keep it in /tmp:
// it's the only writable path on Vercel, and locally it keeps the owner's own
// ~/.claude (memory, plugins, MCP servers) out of the app's requests.
const configDir = join(tmpdir(), "nutribot-claude");

export type BrainResult<T> = {
  data: T;
  model: string;
  durationMs: number;
  costUsd: number;
};

export class BrainError extends Error {}

export async function askClaude<Schema extends z.ZodType>({
  system,
  prompt,
  schema,
  effort = "medium"
}: {
  system: string;
  prompt: string;
  schema: Schema;
  effort?: "low" | "medium" | "high";
}): Promise<BrainResult<z.infer<Schema>>> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new BrainError("CLAUDE_CODE_OAUTH_TOKEN is not set.");
  }
  mkdirSync(configDir, { recursive: true });

  // An API key outranks the OAuth token, which would silently bill per token.
  const { ANTHROPIC_API_KEY: _apiKey, ...env } = process.env;
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const started = Date.now();

  const run = query({
    prompt,
    options: {
      model,
      effort,
      systemPrompt: system,
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 3,
      cwd: tmpdir(),
      env: { ...env, CLAUDE_CONFIG_DIR: configDir } as Record<string, string>,
      // The CLI validates schemas as draft-07; Zod's default 2020-12 tag is rejected.
      outputFormat: {
        type: "json_schema",
        schema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>
      }
    }
  });

  for await (const message of run) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new BrainError(`Claude run failed: ${message.subtype}`);
    }
    const parsed = schema.safeParse(message.structured_output);
    if (!parsed.success) {
      throw new BrainError("Claude returned output that doesn't match the schema.");
    }
    return {
      data: parsed.data,
      model,
      durationMs: Date.now() - started,
      costUsd: message.total_cost_usd
    };
  }
  throw new BrainError("Claude run ended without a result.");
}
