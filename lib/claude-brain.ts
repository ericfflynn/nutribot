import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { query, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

// Runs one request through the Claude Code binary (Agent SDK), authenticated by
// CLAUDE_CODE_OAUTH_TOKEN. No built-in tools, no settings from disk and no
// saved sessions: Claude sees our system prompt, our tools and the prompt.

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Claude Code writes config and caches under CLAUDE_CONFIG_DIR. Keep it in /tmp:
// it's the only writable path on Vercel, and locally it keeps the owner's own
// ~/.claude (memory, plugins, MCP servers) out of the app's requests.
const configDir = join(tmpdir(), "nutribot-claude");

export type ClaudeRun = {
  text: string;
  model: string;
  durationMs: number;
  turns: number;
};

export class BrainError extends Error {}

export async function runClaude({
  system,
  prompt,
  server,
  effort = "low",
  maxTurns = 8
}: {
  system: string;
  prompt: string;
  // In-process MCP server holding our tools; every tool on it is pre-approved.
  server?: { name: string; config: McpSdkServerConfigWithInstance; tools: string[] };
  effort?: "low" | "medium" | "high";
  maxTurns?: number;
}): Promise<ClaudeRun> {
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
      maxTurns,
      cwd: tmpdir(),
      env: { ...env, CLAUDE_CONFIG_DIR: configDir } as Record<string, string>,
      mcpServers: server ? { [server.name]: server.config } : {},
      allowedTools: server ? server.tools.map((tool) => `mcp__${server.name}__${tool}`) : [],
      // Anything not pre-approved above is denied rather than prompted for.
      permissionMode: "dontAsk"
    }
  });

  for await (const message of run) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new BrainError(`Claude run failed: ${message.subtype}`);
    }
    return { text: message.result, model, durationMs: Date.now() - started, turns: message.num_turns };
  }
  throw new BrainError("Claude run ended without a result.");
}
