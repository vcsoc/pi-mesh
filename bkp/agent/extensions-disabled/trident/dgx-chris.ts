/**
 * dgx-chris Custom Provider Extension
 *
 * Registers OpenAI-compatible providers for the two servers forwarded
 * through the `dgx-chris` SSH tunnel (see ~/.ssh/config):
 *
 *   LocalForward 8000 localhost:8000   → vLLM
 *   LocalForward 8001 localhost:8001   → llama.cpp
 *
 * The tunnel is opened/closed via the /dgx command:
 *
 *   /dgx            → connect (default)
 *   /dgx connect    → open the SSH tunnel, wait for ports, reload providers
 *   /dgx disconnect → kill the tunnel process
 *   /dgx status     → check which ports are currently reachable
 *
 * Models are discovered dynamically at startup / after each reload.
 * If an endpoint is unreachable the provider is silently skipped.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { readFile, writeFile, unlink } from "node:fs/promises";

// ── Constants ────────────────────────────────────────────────────────────────

const VLLM_BASE_URL = "http://localhost:8000/v1";
const LLAMACPP_BASE_URL = "http://localhost:8001/v1";
const PID_FILE = "/tmp/.dgx-chris.pid";
const CONNECT_TIMEOUT_MS = 30_000;
const PORT_PROBE_INTERVAL_MS = 600;
const FETCH_TIMEOUT_MS = 3_000;

// ── Port helpers ─────────────────────────────────────────────────────────────

/** Returns true if a TCP connection to 127.0.0.1:<port> succeeds within 500 ms. */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error",   () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

/** Poll until at least one of the two forwarded ports is open, or we time out. */
async function waitForTunnel(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [vllm, llama] = await Promise.all([isPortOpen(8000), isPortOpen(8001)]);
    if (vllm || llama) return true;
    await new Promise<void>((r) => setTimeout(r, PORT_PROBE_INTERVAL_MS));
  }
  return false;
}

// ── PID file ─────────────────────────────────────────────────────────────────

async function savePid(pid: number): Promise<void> {
  await writeFile(PID_FILE, String(pid), "utf8");
}

async function loadPid(): Promise<number | undefined> {
  try {
    const raw = (await readFile(PID_FILE, "utf8")).trim();
    const n = parseInt(raw, 10);
    return isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

async function clearPidFile(): Promise<void> {
  try { await unlink(PID_FILE); } catch { /* already gone */ }
}

/** Kill the tunnel process. Tries saved PID first, then falls back to pkill. */
async function killTunnel(): Promise<void> {
  const pid = await loadPid();
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    await clearPidFile();
    return;
  }
  // No PID file — attempt a best-effort pkill
  try {
    const child = spawn("pkill", ["-f", "ssh -N dgx-chris"], { stdio: "ignore" });
    await new Promise<void>((r) => child.on("close", () => r()));
  } catch { /* ignore */ }
}

// ── Model discovery ───────────────────────────────────────────────────────────

async function fetchModels(
  baseUrl: string,
  label: string,
): Promise<Array<{ id: string; context_window?: number; max_tokens?: number }>> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(tid);

    if (!res.ok) {
      console.warn(`[dgx-chris] ${label}: HTTP ${res.status}`);
      return [];
    }

    const json = (await res.json()) as {
      data?: Array<{ id: string; context_window?: number; max_tokens?: number }>;
    };
    return json.data ?? [];
  } catch {
    return []; // unreachable — skip silently
  }
}

// ── Masked password prompt ───────────────────────────────────────────────────

/** Prompts for a password using a custom TUI component that renders • instead
 *  of the actual characters. Returns the entered string, or null if cancelled. */
async function promptPassword(
  ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  title: string,
  hint: string,
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    let value = "";
    let cachedLines: string[] | undefined;
    let cachedWidth: number | undefined;

    return {
      render(width: number): string[] {
        if (cachedLines && cachedWidth === width) return cachedLines;
        const pad = "  ";
        const masked = "\u2022".repeat(value.length); // •
        const cursor = theme.bg("selectedBg", " ");
        cachedLines = [
          pad + theme.fg("accent", theme.bold(title)),
          pad + theme.fg("dim", hint),
          "",
          pad + theme.fg("muted", "> ") + masked + cursor,
          "",
          pad + theme.fg("dim", "enter  confirm  \u00b7  esc  cancel"),
        ].map((l) => truncateToWidth(l, width));
        cachedWidth = width;
        return cachedLines;
      },

      handleInput(data: string): void {
        if (matchesKey(data, "enter")) {
          done(value || null); // empty string → treat as cancelled
        } else if (matchesKey(data, "escape")) {
          done(null);
        } else if (matchesKey(data, "backspace")) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            cachedLines = undefined;
            tui.requestRender();
          }
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          value += data;
          cachedLines = undefined;
          tui.requestRender();
        }
      },

      invalidate(): void {
        cachedLines = undefined;
        cachedWidth = undefined;
      },
    };
  });
}

// ── Tunnel status footer helper ───────────────────────────────────────────────

async function refreshStatus(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]): Promise<void> {
  const [vllmUp, llamaUp] = await Promise.all([isPortOpen(8000), isPortOpen(8001)]);
  if (!vllmUp && !llamaUp) {
    ctx.ui.setStatus("dgx-chris", undefined);
  } else {
    const parts = [
      vllmUp  && ctx.ui.theme.fg("success", "vLLM:8000"),
      llamaUp && ctx.ui.theme.fg("success", "llama.cpp:8001"),
    ].filter(Boolean) as string[];
    ctx.ui.setStatus(
      "dgx-chris",
      ctx.ui.theme.fg("muted", "dgx ▲ ") + parts.join(ctx.ui.theme.fg("dim", " · ")),
    );
  }
}

// ── Extension entry point ─────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {

  // ── Startup: discover models from whichever servers are reachable ──────────

  const [vllmModels, llamaModels] = await Promise.all([
    fetchModels(VLLM_BASE_URL,    "vLLM"),
    fetchModels(LLAMACPP_BASE_URL, "llama.cpp"),
  ]);

  if (vllmModels.length > 0) {
    pi.registerProvider("dgx-vllm", {
      name: "DGX vLLM (dgx-chris:8000)",
      baseUrl: VLLM_BASE_URL,
      apiKey: "VLLM_API_KEY",
      api: "openai-completions",
      models: vllmModels.map((m) => ({
        id: m.id,
        name: m.id,
        reasoning: false,
        input: ["text"] as ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.context_window ?? 32768,
        maxTokens: m.max_tokens ?? 4096,
        compat: {
          supportsDeveloperRole: false,
          maxTokensField: "max_tokens" as const,
        },
      })),
    });
    console.info(`[dgx-chris] vLLM: ${vllmModels.length} model(s) → ${vllmModels.map((m) => m.id).join(", ")}`);
  }

  if (llamaModels.length > 0) {
    pi.registerProvider("dgx-llamacpp", {
      name: "DGX llama.cpp (dgx-chris:8001)",
      baseUrl: LLAMACPP_BASE_URL,
      apiKey: "LLAMACPP_API_KEY",
      api: "openai-completions",
      models: llamaModels.map((m) => ({
        id: m.id,
        name: m.id,
        reasoning: false,
        input: ["text"] as ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.context_window ?? 32768,
        maxTokens: m.max_tokens ?? 4096,
        compat: {
          supportsDeveloperRole: false,
          maxTokensField: "max_tokens" as const,
        },
      })),
    });
    console.info(`[dgx-chris] llama.cpp: ${llamaModels.length} model(s) → ${llamaModels.map((m) => m.id).join(", ")}`);
  }

  // ── session_start: restore footer status indicator ─────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  // ── /dgx command ───────────────────────────────────────────────────────────

  pi.registerCommand("dgx", {
    description: "Manage dgx-chris SSH tunnel  ·  /dgx [connect|disconnect|status]",

    getArgumentCompletions: (prefix: string) => {
      const opts = [
        { value: "connect",    label: "connect",    description: "Open SSH tunnel and reload providers" },
        { value: "disconnect", label: "disconnect", description: "Close the SSH tunnel" },
        { value: "status",     label: "status",     description: "Check which ports are reachable" },
      ];
      const filtered = opts.filter((o) => o.value.startsWith(prefix));
      return filtered.length ? filtered : null;
    },

    handler: async (args, ctx) => {
      const sub = (args?.trim() || "connect").toLowerCase();

      // ── connect ────────────────────────────────────────────────────────────
      if (sub === "connect") {
        const [vllmUp, llamaUp] = await Promise.all([isPortOpen(8000), isPortOpen(8001)]);

        if (vllmUp || llamaUp) {
          const ports = [
            vllmUp  && "8000 (vLLM)",
            llamaUp && "8001 (llama.cpp)",
          ].filter(Boolean).join(", ");
          ctx.ui.notify(`dgx-chris tunnel already active — ports: ${ports}`, "info");
          return;
        }

        // Prompt for SSH password before spawning — the SSH process runs
        // headless (stdio: ignore) so it can't prompt on the terminal itself.
        // SSH_ASKPASS tells SSH to call our temp script instead.
        // Note: Cloudflare auth happens first (browser opens automatically),
        // then SSH calls the askpass script for the password.
        const password = await promptPassword(
          ctx,
          "SSH password for dgx-chris",
          "(a browser will open for Cloudflare auth first)",
        );
        if (!password) {
          ctx.ui.notify("Cancelled — no password entered.", "warning");
          return;
        }

        // Write credentials to temp files with tight permissions.
        // Using a file rather than a shell string avoids any escaping issues.
        const ts = Date.now();
        const passFile      = `/tmp/.dgx-pass-${ts}`;
        const askpassScript = `/tmp/.dgx-askpass-${ts}.sh`;
        await writeFile(passFile, password, { mode: 0o600 });
        await writeFile(askpassScript, `#!/bin/sh\ncat ${passFile}\n`, { mode: 0o700 });

        ctx.ui.notify(
          "Opening SSH tunnel to dgx-chris… A browser may open for Cloudflare auth.",
          "info",
        );
        ctx.ui.setStatus("dgx-chris", ctx.ui.theme.fg("warning", "dgx ⟳ connecting…"));

        const proc = spawn("ssh", ["-N", "dgx-chris"], {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            SSH_ASKPASS: askpassScript,
            SSH_ASKPASS_REQUIRE: "force", // skip tty fallback, always use askpass
          },
        });
        proc.unref();

        if (proc.pid) {
          await savePid(proc.pid);
        }

        const connected = await waitForTunnel(CONNECT_TIMEOUT_MS);

        // Clean up temp credential files regardless of outcome
        await Promise.all([
          unlink(passFile).catch(() => {}),
          unlink(askpassScript).catch(() => {}),
        ]);

        if (!connected) {
          ctx.ui.setStatus("dgx-chris", ctx.ui.theme.fg("error", "dgx ✗ timed out"));
          ctx.ui.notify(
            "Timed out waiting for dgx-chris tunnel (30 s). " +
            "Check that Cloudflare auth completed and the SSH password was correct.",
            "error",
          );
          return;
        }

        // Reload so the async factory re-runs and registers the new providers
        ctx.ui.notify("Tunnel active — reloading providers…", "info");
        await ctx.reload();
        return;

      // ── disconnect ─────────────────────────────────────────────────────────
      } else if (sub === "disconnect") {
        const [vllmUp, llamaUp] = await Promise.all([isPortOpen(8000), isPortOpen(8001)]);
        if (!vllmUp && !llamaUp) {
          ctx.ui.notify("dgx-chris tunnel is not active.", "warning");
          return;
        }

        await killTunnel();
        ctx.ui.setStatus("dgx-chris", undefined);
        ctx.ui.notify("dgx-chris tunnel closed.", "info");

      // ── status ─────────────────────────────────────────────────────────────
      } else if (sub === "status") {
        const [vllmUp, llamaUp] = await Promise.all([isPortOpen(8000), isPortOpen(8001)]);

        if (!vllmUp && !llamaUp) {
          ctx.ui.notify("dgx-chris: tunnel is NOT active (ports 8000 and 8001 unreachable).", "warning");
        } else {
          const parts = [
            vllmUp  && "8000 (vLLM)",
            llamaUp && "8001 (llama.cpp)",
          ].filter(Boolean).join(", ");
          ctx.ui.notify(`dgx-chris: tunnel is ACTIVE — reachable ports: ${parts}`, "info");
        }

      // ── unknown ────────────────────────────────────────────────────────────
      } else {
        ctx.ui.notify(
          `Unknown subcommand: "${sub}".  Usage: /dgx [connect|disconnect|status]`,
          "warning",
        );
      }
    },
  });
}
