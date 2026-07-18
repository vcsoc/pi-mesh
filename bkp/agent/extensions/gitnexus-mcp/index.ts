/**
 * GitNexus MCP Extension for pi
 *
 * Spawns `gitnexus mcp` as a persistent stdio subprocess and exposes all
 * GitNexus tools as first-class pi tools — no per-call `npx` overhead,
 * no bash round-trips.
 *
 * Tools registered:  query, context, impact, detect_changes, rename,
 *                    cypher, api_impact, list_repos
 *
 * Commands:          /gitnexus:status   — print index status
 *                    /gitnexus:analyze  — re-index the project
 *
 * Status bar:        shows GitNexus ✅ / ⚠️ stale in the footer
 *                    shows a notification when the index is stale
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Binary resolution (module-level so MCP client + commands share it)
// ---------------------------------------------------------------------------

function resolveGitnexusBin(): string {
  // 1. Explicit override for custom installs / wrappers.
  const fromEnv = process.env.GITNEXUS_BIN?.trim();
  if (fromEnv) return fromEnv;

  // 2. Ask the shell — works with PATH managers like Volta, nvm, fnm, mise,
  //    Homebrew, system installs, etc.
  try {
    const bin = execSync("command -v gitnexus", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/sh",
    }).trim();
    if (bin) return bin;
  } catch {}

  // 3. Last resort: rely on PATH at spawn time.
  return "gitnexus";
}

// ---------------------------------------------------------------------------
// Index status
// ---------------------------------------------------------------------------

type IndexStatus =
  | { type: "not-git" }
  | { type: "not-indexed" }
  | { type: "up-to-date"; indexedAt: string; indexedCommit: string }
  | { type: "stale"; indexedAt: string; indexedCommit: string; currentCommit: string };

interface IndexedRepo {
  name: string;
  path: string;
}

const REPO_AWARE_TOOLS = new Set([
  "query",
  "context",
  "impact",
  "cypher",
  "detect_changes",
]);

function getIndexStatus(cwd: string): IndexStatus {
  try {
    const bin = resolveGitnexusBin();
    const out = execSync(`"${bin}" status`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    if (out.includes("Not a git repository")) return { type: "not-git" };
    if (out.includes("Repository not indexed")) return { type: "not-indexed" };

    const indexedAt = out.match(/Indexed:\s+(.+)/)?.[1]?.trim() ?? "";
    const indexedCommit = out.match(/Indexed commit:\s+(\S+)/)?.[1] ?? "";
    const currentCommit = out.match(/Current commit:\s+(\S+)/)?.[1] ?? "";

    // Up-to-date when both commits match (more reliable than parsing the
    // Status line whose wording could change between gitnexus versions)
    if (indexedCommit && currentCommit && indexedCommit === currentCommit) {
      return { type: "up-to-date", indexedAt, indexedCommit };
    }
    if (out.includes("up-to-date") || out.includes("up to date")) {
      return { type: "up-to-date", indexedAt, indexedCommit };
    }
    return { type: "stale", indexedAt, indexedCommit, currentCommit };
  } catch {
    return { type: "not-git" };
  }
}

function isIndexed(cwd: string): boolean {
  const s = getIndexStatus(cwd);
  return s.type === "up-to-date" || s.type === "stale";
}

function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function getGitRoot(cwd: string): string | undefined {
  try {
    return normalizePath(
      execSync("git rev-parse --show-toplevel", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      }).trim(),
    );
  } catch {
    return undefined;
  }
}

function getIndexedRepos(): IndexedRepo[] {
  try {
    const bin = resolveGitnexusBin();
    const out = execSync(`"${bin}" list`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });

    const repos: IndexedRepo[] = [];
    let currentName: string | undefined;

    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      const repoMatch = line.match(/^\s{2}([^:\n][^\n]*)$/);
      if (repoMatch && !line.includes("Indexed Repositories")) {
        currentName = repoMatch[1]?.trim();
        continue;
      }

      const pathMatch = line.match(/^\s*Path:\s+(.+)$/);
      if (currentName && pathMatch?.[1]) {
        repos.push({ name: currentName, path: normalizePath(pathMatch[1].trim()) });
        currentName = undefined;
      }
    }

    return repos;
  } catch {
    return [];
  }
}

function findIndexedRepoForCwd(cwd: string): IndexedRepo | undefined {
  const repos = getIndexedRepos().sort((a, b) => b.path.length - a.path.length);
  if (!repos.length) return undefined;

  const candidates = [normalizePath(cwd), getGitRoot(cwd)].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const match = repos.find((repo) => candidate === repo.path || candidate.startsWith(`${repo.path}/`));
    if (match) return match;
  }

  return undefined;
}

function injectRepoArg(
  toolName: string,
  args: Record<string, unknown>,
  cwd?: string,
): Record<string, unknown> {
  if (!cwd || !REPO_AWARE_TOOLS.has(toolName) || typeof args.repo === "string") {
    return args;
  }

  const repo = findIndexedRepoForCwd(cwd);
  return repo ? { ...args, repo: repo.name } : args;
}

function needsExplicitRepo(toolName: string, cwd?: string): boolean {
  return Boolean(cwd) && REPO_AWARE_TOOLS.has(toolName) && getIndexedRepos().length > 1;
}

function statusBarLabel(status: IndexStatus): string {
  switch (status.type) {
    case "up-to-date": return "GitNexus ✅";
    case "stale":      return "GitNexus ⚠️ stale";
    default:           return "";
  }
}

function statusSummary(status: IndexStatus): string {
  switch (status.type) {
    case "not-git":
      return "Not a git repository — GitNexus requires a git repo.";
    case "not-indexed":
      return "Repository not indexed. Run /gitnexus:analyze to index it.";
    case "up-to-date":
      return `✅ Up-to-date  |  Indexed: ${status.indexedAt}  |  Commit: ${status.indexedCommit}`;
    case "stale":
      return (
        `⚠️  Index is stale\n` +
        `   Indexed commit : ${status.indexedCommit}\n` +
        `   Current commit : ${status.currentCommit}\n` +
        `   Run /gitnexus:analyze to refresh.`
      );
  }
}

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

class GitNexusMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: McpResponse) => void; reject: (e: Error) => void }
  >();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async ensureStarted(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._start();
    return this.initPromise;
  }

  private async _start(): Promise<void> {
    const bin = resolveGitnexusBin();

    this.proc = spawn(bin, ["mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.on("error", (err) => {
      this._rejectAll(new Error(`GitNexus MCP process error: ${err.message}`));
      this._reset();
    });

    this.proc.on("exit", (code) => {
      this._rejectAll(new Error(`GitNexus MCP process exited (code ${code})`));
      this._reset();
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
        // ignore non-JSON lines (e.g. startup logging)
      }
    });

    // MCP initialize handshake
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

  async callTool(
    name: string,
    args: Record<string, unknown>,
    cwd?: string,
  ): Promise<McpToolResult> {
    if (cwd && !isIndexed(cwd)) {
      return {
        content: [
          {
            type: "text",
            text: "This project has not been indexed by GitNexus. Run /gitnexus:analyze (or `gitnexus analyze` in the terminal) first.",
          },
        ],
        isError: true,
      };
    }

    const scopedArgs = injectRepoArg(name, args, cwd);
    if (needsExplicitRepo(name, cwd) && typeof scopedArgs.repo !== "string") {
      return {
        content: [
          {
            type: "text",
            text: "GitNexus could not resolve the indexed repo for the current cwd. Re-run from the project root or refresh the GitNexus index so the current project can be selected explicitly.",
          },
        ],
        isError: true,
      };
    }

    await this.ensureStarted();
    const resp = await this._rpc("tools/call", { name, arguments: scopedArgs });
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

  private _reset(): void {
    this.proc = null;
    this.initialized = false;
    this.initPromise = null;
  }

  shutdown(): void {
    this._rejectAll(new Error("GitNexus MCP client shut down"));
    try { this.proc?.kill(); } catch {}
    this._reset();
  }
}

// ---------------------------------------------------------------------------
// Tool result → pi content helper
// ---------------------------------------------------------------------------

function mcpResultToContent(
  result: McpToolResult,
): Array<{ type: "text"; text: string }> {
  if (!result.content?.length) return [{ type: "text", text: "(no output)" }];
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => ({ type: "text" as const, text: c.text! }));
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI): Promise<void> {
  const client = new GitNexusMcpClient();

  // -------------------------------------------------------------------------
  // session_start — status bar + stale warning
  // -------------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    const status = getIndexStatus(ctx.cwd);

    // Update footer status bar
    const label = statusBarLabel(status);
    ctx.ui.setStatus("gitnexus", label);

    if (status.type === "not-git" || status.type === "not-indexed") return;

    // Warn if stale
    if (status.type === "stale") {
      ctx.ui.notify(
        `GitNexus index is stale (indexed ${status.indexedCommit.slice(0, 7)}, ` +
          `current ${status.currentCommit.slice(0, 7)}). Run /gitnexus:analyze to refresh.`,
        "info",
      );
    }

    // Eagerly start MCP server (don't await — let it warm up in the background)
    client.ensureStarted().catch(() => {});
  });

  // -------------------------------------------------------------------------
  // session_shutdown — clean up MCP server process
  // -------------------------------------------------------------------------
  pi.on("session_shutdown", async () => {
    client.shutdown();
  });

  // -------------------------------------------------------------------------
  // /gitnexus:status — print current index status
  // -------------------------------------------------------------------------
  pi.registerCommand("gitnexus:status", {
    description: "Show GitNexus index status for this project",
    handler: async (_args, ctx) => {
      const status = getIndexStatus(ctx.cwd);
      ctx.ui.notify(statusSummary(status), "info");
      // Refresh the footer too
      ctx.ui.setStatus("gitnexus", statusBarLabel(status));
    },
  });

  // -------------------------------------------------------------------------
  // /gitnexus:analyze — re-index and restart MCP server
  // -------------------------------------------------------------------------
  pi.registerCommand("gitnexus:analyze", {
    description: "Re-index this project with GitNexus (runs gitnexus analyze)",
    handler: (_args, ctx) => {
      return new Promise<void>((resolve) => {
        ctx.ui.setStatus("gitnexus", "GitNexus 🔄 indexing…");
        ctx.ui.notify("GitNexus: starting analysis — this may take a moment…", "info");

        const bin = resolveGitnexusBin();
        const proc = spawn(bin, ["analyze"], {
          cwd: ctx.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        // Stream stderr progress lines into the footer
        const rl = createInterface({ input: proc.stderr!, crlfDelay: Infinity });
        rl.on("line", (line) => {
          const trimmed = line.trim();
          if (trimmed) {
            // Keep the label short for the footer
            const snippet = trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
            ctx.ui.setStatus("gitnexus", `GitNexus 🔄 ${snippet}`);
          }
        });

        proc.on("error", (err) => {
          ctx.ui.setStatus("gitnexus", "GitNexus ❌");
          ctx.ui.notify(`GitNexus: analyze failed — ${err.message}`, "error");
          resolve();
        });

        proc.on("exit", (code) => {
          if (code === 0) {
            // Restart MCP server so it picks up the fresh index
            client.shutdown();
            client.ensureStarted().catch(() => {});

            const status = getIndexStatus(ctx.cwd);
            ctx.ui.setStatus("gitnexus", statusBarLabel(status));
            ctx.ui.notify("GitNexus: analysis complete ✅", "info");
          } else {
            ctx.ui.setStatus("gitnexus", "GitNexus ❌");
            ctx.ui.notify(`GitNexus: analyze exited with code ${code}`, "error");
          }
          resolve();
        });
      });
    },
  });

  // =========================================================================
  // Tools (agent-facing)
  // =========================================================================

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
      task_context: Type.Optional(
        Type.String({ description: "What you are working on — helps ranking" }),
      ),
      goal: Type.Optional(
        Type.String({ description: "What you want to find — helps ranking" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max processes to return (default 5)", default: 5 }),
      ),
      include_content: Type.Optional(
        Type.Boolean({
          description: "Include full symbol source code (default false)",
          default: false,
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "query",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      name: Type.Optional(
        Type.String({ description: "Symbol name (e.g. 'validateUser', 'AuthService')" }),
      ),
      uid: Type.Optional(
        Type.String({
          description: "Direct symbol UID from prior tool results (zero-ambiguity)",
        }),
      ),
      file_path: Type.Optional(
        Type.String({ description: "File path to disambiguate common names" }),
      ),
      kind: Type.Optional(
        Type.String({
          description: "Kind: Function, Class, Method, Interface, Constructor",
        }),
      ),
      include_content: Type.Optional(
        Type.Boolean({
          description: "Include full symbol source code (default false)",
          default: false,
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "context",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      direction: Type.String({
        description:
          "'upstream' (what depends on this) or 'downstream' (what this depends on)",
      }),
      target_uid: Type.Optional(
        Type.String({ description: "Direct symbol UID for zero-ambiguity lookup" }),
      ),
      file_path: Type.Optional(
        Type.String({ description: "File path to disambiguate common names" }),
      ),
      kind: Type.Optional(
        Type.String({
          description: "Kind: Function, Class, Method, Interface, Constructor",
        }),
      ),
      maxDepth: Type.Optional(
        Type.Number({ description: "Max relationship depth (default 3)", default: 3 }),
      ),
      includeTests: Type.Optional(
        Type.Boolean({ description: "Include test files (default false)", default: false }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "impact",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      scope: Type.Optional(
        Type.String({
          description: "'unstaged' (default), 'staged', 'all', or 'compare'",
          enum: ["unstaged", "staged", "all", "compare"],
        }),
      ),
      base_ref: Type.Optional(
        Type.String({
          description: "Branch/commit for 'compare' scope (e.g. 'main')",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "detect_changes",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      symbol_name: Type.Optional(
        Type.String({ description: "Current symbol name to rename" }),
      ),
      symbol_uid: Type.Optional(
        Type.String({ description: "Direct symbol UID for zero-ambiguity" }),
      ),
      file_path: Type.Optional(
        Type.String({ description: "File path to disambiguate common names" }),
      ),
      dry_run: Type.Optional(
        Type.Boolean({
          description: "Preview without modifying files (default true)",
          default: true,
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "rename",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      const result = await client.callTool(
        "cypher",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
      route: Type.Optional(
        Type.String({ description: "Route path, e.g. '/api/accounts'" }),
      ),
      file: Type.Optional(
        Type.String({ description: "Handler file path (alternative to route)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await client.callTool(
        "api_impact",
        params as Record<string, unknown>,
        ctx.cwd,
      );
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
