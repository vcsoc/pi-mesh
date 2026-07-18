import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const loops = new Map<number, {
  id: number;
  intervalMs: number;
  expiresAt?: number;
  prompt: string;
  runCount: number;
  timer?: NodeJS.Timeout;
}>();

let nextId = 1;

function parseDuration(input: string): number | undefined {
  const m = input.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return undefined;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return value * mult;
}

function trimQuotes(text: string): string {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function parseLoopArgs(args: string): { intervalMs: number; expiresAt?: number; prompt: string } | { error: string } {
  const trimmed = args.trim();
  if (!trimmed) return { error: "Usage: /loop <interval> <prompt>  OR  /loop \"prompt\" --interval 30m [--expires 8h]" };

  const firstToken = trimmed.split(/\s+/, 1)[0] || "";
  const firstDuration = parseDuration(firstToken);
  if (firstDuration) {
    const prompt = trimmed.slice(firstToken.length).trim();
    if (!prompt) return { error: "Missing prompt after interval." };
    return { intervalMs: firstDuration, prompt };
  }

  const intervalMatch = trimmed.match(/--interval\s+(\S+)/);
  if (!intervalMatch) return { error: "Missing --interval value." };
  const intervalMs = parseDuration(intervalMatch[1]);
  if (!intervalMs) return { error: `Invalid interval: ${intervalMatch[1]}` };

  const expiresMatch = trimmed.match(/--expires\s+(\S+)/);
  const expiresMs = expiresMatch ? parseDuration(expiresMatch[1]) : undefined;

  const prompt = trimQuotes(
    trimmed
      .replace(/--interval\s+\S+/, "")
      .replace(/--expires\s+\S+/, "")
      .trim(),
  );

  if (!prompt) return { error: "Missing prompt." };
  return { intervalMs, expiresAt: expiresMs ? Date.now() + expiresMs : undefined, prompt };
}

function updateStatus(ctx: any) {
  const count = loops.size;
  ctx.ui?.setStatus?.("loop", count ? `loops:${count}` : undefined);
}

function queueLoopRun(pi: ExtensionAPI, ctx: any, loop: { id: number; prompt: string; runCount: number }) {
  const message = `/skill:loop Scheduled loop #${loop.id} run ${loop.runCount + 1}: ${loop.prompt}`;
  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
  } else {
    pi.sendUserMessage(message, { deliverAs: "followUp" });
  }
}

function scheduleNext(pi: ExtensionAPI, ctx: any, id: number) {
  const loop = loops.get(id);
  if (!loop) return;

  loop.timer = setTimeout(() => {
    const current = loops.get(id);
    if (!current) return;

    if (current.expiresAt && Date.now() >= current.expiresAt) {
      loops.delete(id);
      updateStatus(ctx);
      ctx.ui?.notify?.(`Loop #${id} expired`, "info");
      return;
    }

    current.runCount += 1;
    queueLoopRun(pi, ctx, current);
    scheduleNext(pi, ctx, id);
  }, loop.intervalMs);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    for (const loop of loops.values()) {
      if (loop.timer) clearTimeout(loop.timer);
    }
    loops.clear();
    updateStatus(ctx);
  });

  pi.registerCommand("loop", {
    description: "Schedule a recurring /skill:loop run. Example: /loop 10m check logs",
    handler: async (args, ctx) => {
      const parsed = parseLoopArgs(args || "");
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }

      const id = nextId++;
      loops.set(id, {
        id,
        intervalMs: parsed.intervalMs,
        expiresAt: parsed.expiresAt,
        prompt: parsed.prompt,
        runCount: 0,
      });
      scheduleNext(pi, ctx, id);
      updateStatus(ctx);
      ctx.ui.notify(`Loop #${id} started`, "info");
      pi.sendMessage({
        customType: "loop",
        display: true,
        content: `Started loop #${id}\n\nInterval: ${Math.round(parsed.intervalMs / 1000)}s\nPrompt: ${parsed.prompt}`,
        details: { id, intervalMs: parsed.intervalMs, expiresAt: parsed.expiresAt, prompt: parsed.prompt },
      });
    },
  });

  pi.registerCommand("loop-list", {
    description: "List active loops",
    handler: async (_args, ctx) => {
      if (!loops.size) {
        ctx.ui.notify("No active loops", "info");
        return;
      }
      const lines = [...loops.values()].map((loop) =>
        `#${loop.id} every ${Math.round(loop.intervalMs / 1000)}s runs=${loop.runCount} prompt=${loop.prompt}`,
      );
      pi.sendMessage({ customType: "loop", display: true, content: lines.join("\n") });
    },
  });

  pi.registerCommand("loop-stop", {
    description: "Stop one loop by id or all loops",
    handler: async (args, ctx) => {
      const target = (args || "").trim();
      if (!target) {
        ctx.ui.notify("Usage: /loop-stop <id|all>", "warning");
        return;
      }
      if (target === "all") {
        for (const loop of loops.values()) {
          if (loop.timer) clearTimeout(loop.timer);
        }
        loops.clear();
        updateStatus(ctx);
        ctx.ui.notify("Stopped all loops", "info");
        return;
      }
      const id = Number(target);
      const loop = loops.get(id);
      if (!loop) {
        ctx.ui.notify(`Loop #${target} not found`, "warning");
        return;
      }
      if (loop.timer) clearTimeout(loop.timer);
      loops.delete(id);
      updateStatus(ctx);
      ctx.ui.notify(`Stopped loop #${id}`, "info");
    },
  });
}
