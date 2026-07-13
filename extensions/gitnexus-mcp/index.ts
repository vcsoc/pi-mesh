/**
 * GitNexus MCP Extension for pi
 *
 * Spawns `gitnexus mcp` as a persistent stdio subprocess and exposes all
 * GitNexus tools as first-class pi tools — no per-call `npx` overhead,
 * no bash round-trips.
 *
 * Tools registered: query, context, impact, detect_changes, rename,
 *                   cypher, route_map, api_impact, shape_check, list_repos
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

interface McpRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const GITNEXUS_TOOL_NAMES = [
  "gitnexus_query",
  "gitnexus_context",
  "gitnexus_impact",
  "gitnexus_detect_changes",
  "gitnexus_rename",
  "gitnexus_cypher",
  "gitnexus_api_impact",
  "gitnexus_list_repos",
] as const;

class GitNexusMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: McpResponse) => void; reject: (e: Error) => void }>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async ensureStarted(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._start();
    return this.initPromise;
  }

  private async _start(): Promise<void> {
    const command = resolveGitnexusCommand();

    this.proc = spawn(command.file, command.args("mcp"), {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      shell: command.needsShell,
    });

    this.proc.on("error", (err) => {
      this._rejectAll(new Error(`GitNexus MCP process error: ${err.message}`));
      this.proc = null;
      this.initialized = false;
      this.initPromise = null;
    });

    this.proc.on("exit", (code) => {
      this._rejectAll(new Error(`GitNexus MCP process exited (code ${code})`));
      this.proc = null;
      this.initialized = false;
      this.initPromise = null;
    });

    // Parse newline-delimited JSON from stdout
    const rl = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      try {
        const msg = JSON.parse(line) as McpResponse;
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve(msg);
        }
      } catch {
        // ignore non-JSON lines (e.g. logging)
      }
    });

    // Send MCP initialize handshake
    await this._rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-gitnexus-extension", version: "1.0.0" },
    });

    this.initialized = true;
  }


  private _rpc(method: string, params?: unknown): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error("GitNexus MCP process not running"));
        return;
      }
      const id = this.nextId++;
      const msg: McpRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  async callTool(name: string, args: Record<string, unknown>, cwd?: string): Promise<McpToolResult> {
    if (cwd && !isIndexed(cwd)) {
      return {
        content: [{ type: "text", text: "This project has not been indexed by GitNexus. Run `gitnexus analyze` first." }],
        isError: true,
      };
    }
    await this.ensureStarted();
    const resp = await this._rpc("tools/call", { name, arguments: args });
    if (resp.error) {
      return {
        content: [{ type: "text", text: `GitNexus error: ${resp.error.message}` }],
        isError: true,
      };
    }
    return resp.result as McpToolResult;
  }

  private _rejectAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  shutdown(): void {
    this._rejectAll(new Error("GitNexus MCP client shut down"));
    try { this.proc?.kill(); } catch {}
    this.proc = null;
    this.initialized = false;
    this.initPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Tool result → pi content helper
// ---------------------------------------------------------------------------

function mcpResultToContent(result: McpToolResult): Array<{ type: "text"; text: string }> {
  if (!result.content?.length) return [{ type: "text", text: "(no output)" }];
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => ({ type: "text" as const, text: c.text! }));
}

// ---------------------------------------------------------------------------
// Index check
// ---------------------------------------------------------------------------

type GitNexusCommand = {
  file: string;
  args: (...extra: string[]) => string[];
  needsShell: boolean;
};

function resolveGitnexusCommand(): GitNexusCommand {
  const pathCandidates = process.platform === "win32"
    ? [
        process.env.GITNEXUS_BIN,
        process.env.npm_config_prefix ? join(process.env.npm_config_prefix, "gitnexus.cmd") : undefined,
        process.env.APPDATA ? join(process.env.APPDATA, "npm", "gitnexus.cmd") : undefined,
        process.env.APPDATA ? join(process.env.APPDATA, "npm", "gitnexus.ps1") : undefined,
      ]
    : [
        process.env.GITNEXUS_BIN,
        process.env.HOME ? join(process.env.HOME, ".volta", "bin", "gitnexus") : undefined,
        process.env.HOME ? join(process.env.HOME, ".npm", "bin", "gitnexus") : undefined,
      ];

  for (const candidate of pathCandidates) {
    if (candidate && existsSync(candidate)) {
      return {
        file: candidate,
        args: (...extra) => extra,
        needsShell: process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate),
      };
    }
  }

  const locator = process.platform === "win32" ? ["where", "gitnexus"] : ["which", "gitnexus"];
  try {
    const located = execFileSync(locator[0], locator.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && existsSync(line));
    if (located) {
      return {
        file: located,
        args: (...extra) => extra,
        needsShell: process.platform === "win32" && /\.(cmd|bat)$/i.test(located),
      };
    }
  } catch {}

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    file: npx,
    args: (...extra) => ["gitnexus", ...extra],
    needsShell: process.platform === "win32",
  };
}

function runGitnexus(args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const command = resolveGitnexusCommand();
  const result = spawnSync(command.file, command.args(...args), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    shell: command.needsShell,
    env: { ...process.env },
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function isIndexed(cwd: string): boolean {
  const result = runGitnexus(["status"], cwd);
  return result.ok && result.stdout.includes("Indexed:");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI): Promise<void> {
  const client = new GitNexusMcpClient();

  pi.registerCommand("gitnexus:status", {
    description: "Show GitNexus MCP extension status and index status for this project",
    handler: async (_args, ctx) => {
      const allTools = new Set(pi.getAllTools().map((tool) => tool.name));
      const activeTools = new Set(pi.getActiveTools());
      const loaded = GITNEXUS_TOOL_NAMES.filter((name) => allTools.has(name));
      const active = GITNEXUS_TOOL_NAMES.filter((name) => activeTools.has(name));
      const result = runGitnexus(["status"], ctx.cwd);
      const output = (result.stdout || result.stderr || "No output from `gitnexus status`.").trim();
      ctx.ui.notify(
        `GitNexus MCP loaded=${loaded.length}/${GITNEXUS_TOOL_NAMES.length} active=${active.length}/${GITNEXUS_TOOL_NAMES.length}`,
        loaded.length === GITNEXUS_TOOL_NAMES.length ? "info" : "warning",
      );
      pi.sendMessage({
        customType: "gitnexus-status",
        display: true,
        content: `## gitnexus status\n\n\`\`\`\n${output}\n\`\`\``,
        details: {
          ok: result.ok,
          output,
          loaded: loaded.length,
          active: active.length,
          total: GITNEXUS_TOOL_NAMES.length,
        },
      });
    },
  });

  pi.registerCommand("gitnexus:analyze", {
    description: "Analyze or refresh the GitNexus index for this project",
    handler: async (_args, ctx) => {
      ctx.ui.notify("GitNexus analyze started…", "info");
      const command = resolveGitnexusCommand();
      await new Promise<void>((resolve) => {
        const proc = spawn(command.file, command.args("analyze"), {
          cwd: ctx.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
          shell: command.needsShell,
        });

        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (chunk) => { stdout += String(chunk); });
        proc.stderr?.on("data", (chunk) => { stderr += String(chunk); });

        proc.on("error", (err) => {
          ctx.ui.notify(`GitNexus analyze failed: ${err.message}`, "error");
          resolve();
        });

        proc.on("exit", async (code) => {
          const output = (stdout || stderr || `gitnexus analyze exited with code ${code}`).trim();
          if (code === 0) {
            client.shutdown();
            if (isIndexed(ctx.cwd)) {
              try {
                await client.ensureStarted();
              } catch {}
            }
            ctx.ui.notify("GitNexus analyze complete", "info");
          } else {
            ctx.ui.notify(`GitNexus analyze exited with code ${code}`, "error");
          }
          pi.sendMessage({
            customType: "gitnexus-analyze",
            display: true,
            content: `## gitnexus analyze\n\n\`\`\`\n${output}\n\`\`\``,
            details: { code, output },
          });
          resolve();
        });
      });
    },
  });

  // Eagerly start the MCP server at session start — but only when the
  // current working directory is a GitNexus-indexed repo.
  pi.on("session_start", async (_event, ctx) => {
    const activeTools = new Set(pi.getActiveTools());
    let changed = false;
    for (const toolName of GITNEXUS_TOOL_NAMES) {
      if (!activeTools.has(toolName)) {
        activeTools.add(toolName);
        changed = true;
      }
    }
    if (changed) {
      pi.setActiveTools(Array.from(activeTools));
    }

    if (!isIndexed(ctx.cwd)) return;
    try {
      await client.ensureStarted();
    } catch {
      // Non-fatal — tools will retry on first use
    }
  });

  pi.on("session_shutdown", async () => {
    client.shutdown();
  });

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_query",
    label: "GitNexus: Query",
    description:
      "Search the code knowledge graph for execution flows related to a concept. " +
      "Returns processes (call chains) ranked by relevance. Use this to understand how code works together.",
    promptSnippet: "Search the GitNexus knowledge graph for execution flows",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language or keyword search query" }),
      task_context: Type.Optional(Type.String({ description: "What you are working on — helps ranking" })),
      goal: Type.Optional(Type.String({ description: "What you want to find — helps ranking" })),
      limit: Type.Optional(Type.Number({ description: "Max processes to return (default 5)", default: 5 })),
      include_content: Type.Optional(Type.Boolean({ description: "Include full symbol source code (default false)", default: false })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("query", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // context
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_context",
    label: "GitNexus: Context",
    description:
      "360-degree view of a single code symbol: callers, callees, process participation, and file location. " +
      "Use after query() to understand a specific symbol in depth.",
    promptSnippet: "Get full context (callers, callees, processes) for a code symbol",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Symbol name (e.g. 'validateUser', 'AuthService')" })),
      uid: Type.Optional(Type.String({ description: "Direct symbol UID from prior tool results (zero-ambiguity)" })),
      file_path: Type.Optional(Type.String({ description: "File path to disambiguate common names" })),
      kind: Type.Optional(Type.String({ description: "Kind: Function, Class, Method, Interface, Constructor" })),
      include_content: Type.Optional(Type.Boolean({ description: "Include full symbol source code (default false)", default: false })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("context", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // impact
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_impact",
    label: "GitNexus: Impact",
    description:
      "Blast radius analysis: what breaks if you change a symbol. " +
      "Returns affected symbols by depth (d=1 WILL BREAK, d=2 LIKELY AFFECTED, d=3 MAY NEED TESTING), " +
      "risk level (LOW/MEDIUM/HIGH/CRITICAL), and affected execution flows.",
    promptSnippet: "Blast-radius analysis before modifying a function, class, or method",
    promptGuidelines: [
      "Use gitnexus_impact BEFORE editing any function, class, or method to assess the blast radius.",
      "If gitnexus_impact returns HIGH or CRITICAL risk, warn the user before proceeding with edits.",
    ],
    parameters: Type.Object({
      target: Type.String({ description: "Name of function, class, or file to analyse" }),
      direction: Type.String({ description: "'upstream' (what depends on this) or 'downstream' (what this depends on)" }),
      target_uid: Type.Optional(Type.String({ description: "Direct symbol UID for zero-ambiguity lookup" })),
      file_path: Type.Optional(Type.String({ description: "File path to disambiguate common names" })),
      kind: Type.Optional(Type.String({ description: "Kind: Function, Class, Method, Interface, Constructor" })),
      maxDepth: Type.Optional(Type.Number({ description: "Max relationship depth (default 3)", default: 3 })),
      includeTests: Type.Optional(Type.Boolean({ description: "Include test files (default false)", default: false })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("impact", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // detect_changes
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_detect_changes",
    label: "GitNexus: Detect Changes",
    description:
      "Map git diff hunks to indexed symbols and find affected execution flows. " +
      "Run before committing to understand what your changes affect.",
    promptSnippet: "Analyse uncommitted git changes and identify affected execution flows",
    promptGuidelines: [
      "Use gitnexus_detect_changes before every commit to verify changes only affect expected symbols.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.String({
        description: "'unstaged' (default), 'staged', 'all', or 'compare'",
        enum: ["unstaged", "staged", "all", "compare"],
      })),
      base_ref: Type.Optional(Type.String({ description: "Branch/commit for 'compare' scope (e.g. 'main')" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("detect_changes", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // rename
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_rename",
    label: "GitNexus: Rename",
    description:
      "Multi-file coordinated rename using the knowledge graph + text search. " +
      "Safer than find-and-replace. Each edit is tagged with confidence: 'graph' (high) or 'text_search' (review carefully). " +
      "Dry-run by default — set dry_run: false to apply.",
    promptSnippet: "Safe multi-file symbol rename using the knowledge graph",
    promptGuidelines: [
      "Use gitnexus_rename instead of find-and-replace when renaming functions, classes, or methods.",
    ],
    parameters: Type.Object({
      new_name: Type.String({ description: "The new name for the symbol" }),
      symbol_name: Type.Optional(Type.String({ description: "Current symbol name to rename" })),
      symbol_uid: Type.Optional(Type.String({ description: "Direct symbol UID for zero-ambiguity" })),
      file_path: Type.Optional(Type.String({ description: "File path to disambiguate common names" })),
      dry_run: Type.Optional(Type.Boolean({ description: "Preview without modifying files (default true)", default: true })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("rename", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // cypher
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_cypher",
    label: "GitNexus: Cypher",
    description:
      "Execute a raw Cypher query against the GitNexus knowledge graph. " +
      "For complex structural queries that query/context cannot answer.",
    promptSnippet: "Run a raw Cypher query against the code knowledge graph",
    parameters: Type.Object({
      query: Type.String({ description: "Cypher query to execute" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("cypher", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // api_impact
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_api_impact",
    label: "GitNexus: API Impact",
    description:
      "Pre-change impact report for an API route handler. " +
      "Shows consumers, response shapes, middleware, and execution flows. " +
      "Run BEFORE modifying any API route handler.",
    promptSnippet: "Pre-change impact report for an API route handler",
    promptGuidelines: [
      "Use gitnexus_api_impact BEFORE modifying any API route handler to understand consumer blast radius.",
    ],
    parameters: Type.Object({
      route: Type.Optional(Type.String({ description: "Route path, e.g. '/api/accounts'" })),
      file: Type.Optional(Type.String({ description: "Handler file path (alternative to route)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("api_impact", params as Record<string, unknown>, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });

  // -------------------------------------------------------------------------
  // list_repos
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "gitnexus_list_repos",
    label: "GitNexus: List Repos",
    description: "List all repositories indexed by GitNexus, with stats and last-indexed date.",
    promptSnippet: "List all GitNexus-indexed repositories",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const result = await client.callTool("list_repos", {}, ctx.cwd);
      return { content: mcpResultToContent(result), details: { isError: result.isError } };
    },
  });
}