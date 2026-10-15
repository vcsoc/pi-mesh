import { spawn } from "node:child_process";
import { createActivity } from "./activity.mjs";
import { registerWork } from "./work.ts";
import { editProjectConfig } from './config-tui.ts';
import { diagnoseMesh } from './doctor.mjs';
import { canonicalProject, nodeExecutable } from './fleet.mjs';
import { listRuns, enqueueControl, terminal } from './fleet-store.mjs';
import { roleMemory, recordHandoff, messageText } from './context-memory.mjs';
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const VERSION = "2.8.1";
const DEFAULT_PORT = 47831;
const MESH_TOOLS = ["agent_mesh_send", "agent_mesh_agents", "agent_mesh_history", "agent_mesh_channels", "agent_mesh_tasks"];
const extensionDir = dirname(fileURLToPath(import.meta.url));
const stateDir = resolve(process.env.PI_AGENT_MESH_HOME || join(homedir(), ".pi", "agent-mesh"));
const configPath = join(stateDir, "config.json");
const brokerPath = join(extensionDir, "broker.mjs");

type Status = "idle" | "working" | "offline";
type MessageKind = "message" | "question" | "plan" | "task" | "decision" | "status" | "steer";
interface Config { version: number; host: "127.0.0.1"; port: number; token: string; dataDir: string; createdAt: string; }
interface Agent { id: string; name: string; role?: string; cwd: string; model: string | null; thinkingLevel?: string | null; configurable?: boolean; status: Status; lastAck: number; channels: string[]; activeChannel: string | null; enabled: boolean; projectHash: string; projectName: string; }
interface Channel { userOnly?: boolean; name: string; createdAt: string; createdBy: string; joined: boolean; active: boolean; memberIds: string[]; memberNames: string[]; memberCount: number; }
type Destination = { type: "agent"; id: string; name: string } | { type: "channel"; id: string; name: string } | { type: "all"; id: null; name: "All agents" };
interface Message { id: number; messageId: string; timestamp: string; fromType: "agent" | "user"; fromAgentId: string | null; fromName: string; destination: Destination; scopeChannel?: string | null; recipientAgentIds: string[]; kind: MessageKind; content: string; }
class MeshRequestError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
function friendlyMeshMessage(code: string | undefined, message: string) {
	const projectBlockedMessage = "This project has been blocked from using mesh. Please contact your administrator to unblock it.";
	if (/projectHash.*invalid/i.test(message)) return projectBlockedMessage;
	const known: Record<string, string> = {
		INVALID_PROJECT_HASH: projectBlockedMessage,
		PROJECT_IDENTITY_MISMATCH: "This Pi session is registered to a different project. Start a new Pi session from the project you want to use.",
		PROJECT_BLOCKED: projectBlockedMessage,
		MESH_DISABLED: "Agent Mesh is turned off. Run /mesh on to turn it back on.",
		AGENT_DISABLED: "This agent has been disabled. Re-enable it from the Mesh dashboard to continue.",
		AGENT_REMOVED: "This agent is disconnected from Agent Mesh. Run /mesh join to reconnect.",
		AGENT_NOT_FOUND: "This agent is not connected to Agent Mesh. Run /mesh join to connect.",
		AGENT_NAME_TAKEN: "That agent name is already in use. Choose another name or add --force.",
		CHANNEL_MEMBERSHIP_REQUIRED: "Join this channel before sending a message to it.",
		NO_SHARED_CHANNEL: "You can only contact agents with the same active channel. Use /mesh switch to change channels.",
		NO_ACTIVE_CHANNEL: "No active channel. Use /mesh join or /mesh switch to select one.",
		ACTIVE_CHANNEL_REQUIRED: "Switch to that channel with /mesh switch before sending to it.",
		CHANNEL_HAS_NO_RECIPIENTS: "No eligible recipients in that channel. Peers must have the same active channel for agent coordination.",
		CHANNEL_NOT_FOUND: "That channel does not exist.",
		CHANNEL_CLOSED: "That channel is closed and cannot be used.",
	};
	return known[code || ""] || message.replace(/\bprojectHash\b/g, "project identity").replace(/\bagentId\b/g, "agent").replace(/\bmust be boolean\b/g, "must be turned on or off");
}
function friendlyError(cause: unknown) { return cause instanceof MeshRequestError ? friendlyMeshMessage(cause.code, cause.message) : cause instanceof Error ? cause.message : "Agent Mesh could not complete that action. Please try again."; }

function configuration(): Config {
	mkdirSync(stateDir, { recursive: true });
	if (existsSync(configPath)) { const existing = JSON.parse(readFileSync(configPath, "utf8")) as Config; if (existing.version !== 2) { existing.version = 2; writeFileSync(configPath, JSON.stringify(existing, null, 2), { encoding: "utf8", mode: 0o600 }); } return existing; }
	const requested = Number(process.env.PI_AGENT_MESH_PORT || DEFAULT_PORT);
	const value: Config = { version: 2, host: "127.0.0.1", port: Number.isInteger(requested) && requested >= 1024 && requested <= 65535 ? requested : DEFAULT_PORT, token: randomBytes(32).toString("hex"), dataDir: join(stateDir, "data"), createdAt: new Date().toISOString() };
	try { writeFileSync(configPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" }); return value; }
	catch (cause) { if (existsSync(configPath)) return JSON.parse(readFileSync(configPath, "utf8")); throw cause; }
}
const model = (ctx: ExtensionContext) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
function projectIdentity(cwd: string) { const resolved = resolve(cwd), pathExists = existsSync(resolved), start = pathExists ? realpathSync(resolved) : resolved; let cursor = start, root = start; while (pathExists) { if (existsSync(join(cursor, ".git"))) { root = cursor; break; } const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; } const normalized = process.platform === "win32" ? root.toLocaleLowerCase("en-US") : root; return { projectHash: createHash("sha256").update(`agent-mesh-project\0${normalized}`).digest("hex"), projectName: basename(root) || "project" }; }
function open(url: string) { if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref(); else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref(); }

export default function agentMesh(pi: ExtensionAPI) {
	let config: Config | undefined, ctx: ExtensionContext | undefined, agent: Agent | undefined, removedName = "", removed = false, removalNotified = false, unavailableCode = "", id = "", polling = false;
	const activity = createActivity();
	let heartbeatRunning = false, heartbeatAgain = false, configuring = false, lastCatalogAt = 0;
	const modelCatalog=(current:ExtensionContext)=>current.modelRegistry.getAvailable().slice(0,100).map(m=>({id:`${m.provider}/${m.id}`,levels:getSupportedThinkingLevels(m)}));
	const updateActivity = (event: string, data?: any) => { if (activity.update(event, data)) void heartbeat(); };
	let pollTimer: NodeJS.Timeout | undefined, heartbeatTimer: NodeJS.Timeout | undefined, starting: Promise<void> | undefined;
	const base = () => { if (!config) throw new Error("Agent Mesh not initialized"); return `http://${config.host}:${config.port}`; };
	const fingerprint = () => createHash("sha256").update(config!.token).digest("hex").slice(0, 16);

	async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
		config = configuration();
		const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${config.token}`); if (init.body) headers.set("Content-Type", "application/json");
		const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
		try { const response = await fetch(`${base()}${path}`, { ...init, headers, signal: init.signal || controller.signal }); const result = await response.json().catch(() => ({})); if (!response.ok) { const code = result.error?.code; throw new MeshRequestError(friendlyMeshMessage(code, result.error?.message || `Agent Mesh request failed (${response.status}).`), response.status, code); } return result as T; }
		finally { clearTimeout(timer); }
	}
	async function probe(timeoutMs = 800): Promise<{ ok?: boolean; version?: string; instance?: string; pid?: number } | null> {
		try { const response = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(Math.max(1, timeoutMs)) }); return response.ok ? await response.json() : null; }
		catch { return null; }
	}
	function compatibleBroker(health: { ok?: boolean; version?: string; instance?: string } | null) { const expected = VERSION.split(".").map(Number), actual = String(health?.version || "").split(".").map(Number); return Boolean(health?.ok && health.instance === fingerprint() && actual.length === 3 && actual[0] === expected[0] && actual[1] === expected[1] && actual[2] >= expected[2]); }
	async function broker() {
		config = configuration(); if (starting) return starting;
		const first = await probe();
		if (compatibleBroker(first)) return;
		if (first?.ok && first.instance !== fingerprint()) throw new Error(`A broker with different credentials is already running at ${base()}. Restart the Agent Mesh broker using ${configPath}; do not delete the config or disable authentication.`);
		if (first?.instance === fingerprint() && Number.isInteger(first.pid)) { try { process.kill(first.pid!, "SIGTERM"); await new Promise((done) => setTimeout(done, 150)); } catch { /* stale broker */ } }
		if (starting) return starting;
		const deadline = Date.now() + 10000;
		starting = (async () => {
			const executable = nodeExecutable();
			const child = spawn(executable, [brokerPath, configPath], { detached: true, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
			let failure = "", stderr = "";
			child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
			child.on("error", error => { failure = error.message; });
			child.on("exit", code => { failure = stderr.trim() || `Broker exited (${code})`; });
			child.unref();
			while (Date.now() < deadline) {
				if (failure) { if (compatibleBroker(await probe())) return; throw new Error(`Agent Mesh could not start: ${failure}`); } await new Promise((done) => setTimeout(done, Math.min(100, Math.max(1, deadline - Date.now())))); const remaining = deadline - Date.now(), health = remaining > 0 ? await probe(Math.min(800, remaining)) : null; if (compatibleBroker(health)) { child.stderr?.destroy(); return; } }
			child.stderr?.destroy();
			throw new Error(`Broker did not start within 10s at ${base()}${stderr ? `: ${stderr.trim()}` : ""}`);
		})().finally(() => { starting = undefined; });
		return starting;
	}
	function stopTimers() { if (pollTimer) clearInterval(pollTimer); if (heartbeatTimer) clearInterval(heartbeatTimer); pollTimer = undefined; heartbeatTimer = undefined; }
	function startTimers() { stopTimers(); pollTimer = setInterval(() => void poll(), 250); heartbeatTimer = setInterval(() => void heartbeat(), 5000); pollTimer.unref(); heartbeatTimer.unref(); }
	function deactivateTools() { const active = pi.getActiveTools(), next = active.filter((name) => !MESH_TOOLS.includes(name)); if (next.length !== active.length) pi.setActiveTools(next); }
	function markRemoved(current: ExtensionContext, voluntary = false) { if (!removedName) removedName = agent?.name || "this agent"; removed = true; unavailableCode = voluntary ? "AGENT_LEFT" : "AGENT_REMOVED"; agent = undefined; stopTimers(); deactivateTools(); const label = voluntary ? "left" : "removed"; current.ui.setStatus("agent-mesh", current.ui.theme.fg("error", `mesh:${label}`)); current.ui.setWidget("agent-mesh", [current.ui.theme.fg("warning", `${voluntary ? "Disconnected from" : "Removed from"} Agent Mesh • /mesh join to register again`)], { placement: "belowEditor" }); if (!removalNotified && current.hasUI) { removalNotified = true; current.ui.notify(`${voluntary ? "This agent disconnected from" : "This agent was removed from"} Agent Mesh. Run /mesh join to register again.`, "warning"); } }
	function markUnavailable(current: ExtensionContext, code: string) { unavailableCode = code; agent = undefined; deactivateTools(); const labels: Record<string, string> = { MESH_DISABLED: "off", AGENT_DISABLED: "disabled", PROJECT_BLOCKED: "project-blocked" }, label = labels[code] || "offline"; current.ui.setStatus("agent-mesh", current.ui.theme.fg("warning", `mesh:${label}`)); current.ui.setWidget("agent-mesh", [current.ui.theme.fg("warning", code === "MESH_DISABLED" ? "Agent Mesh is off for all agents • /mesh on" : code === "PROJECT_BLOCKED" ? "This project is blocked from Agent Mesh" : "This participant is disabled in Agent Mesh")], { placement: "belowEditor" }); }
	function uiStatus() {
		if (!ctx) return;
		if (removed) return;
		if (!agent) return;
		unavailableCode = ""; activateTools();
		ctx.ui.setStatus("agent-mesh", ctx.ui.theme.fg("accent", `mesh:${agent.name} ${agent.activeChannel ? `#${agent.activeChannel}` : '(no channel)'}`));
		ctx.ui.setWidget("agent-mesh", [ctx.ui.theme.fg("dim", `Agent Mesh • ${agent.name} • active:${agent.activeChannel ? `#${agent.activeChannel}` : 'none'} • joined:${agent.channels.length} • /mesh switch • /mesh help`)], { placement: "belowEditor" });
	}
	async function register(current: ExtensionContext, requestedName?: string) { await broker(); id = current.sessionManager.getSessionId(); const identity = projectIdentity(current.cwd); const result = await request<{ agent: Agent }>("/api/register", { method: "POST", body: JSON.stringify({ agentId: id, requestedName: requestedName?.trim() || process.env.PI_AGENT_NAME?.trim() || undefined, role: process.env.PI_AGENT_ROLE || 'orchestrator', cwd: current.cwd, ...identity, sessionFile: current.sessionManager.getSessionFile() || "", model: model(current),thinkingLevel:pi.getThinkingLevel(),configSupport:true,modelCatalog:modelCatalog(current), status: current.isIdle() ? "idle" : "working" }) }); agent = result.agent; removed = false; unavailableCode = ""; removedName = ""; removalNotified = false;lastCatalogAt=Date.now(); uiStatus(); }
	async function rejoin(current: ExtensionContext) { id = current.sessionManager.getSessionId(); const identity = projectIdentity(current.cwd); const result = await request<{ agent: Agent }>("/api/agents/rejoin", { method: "POST", body: JSON.stringify({ agentId: id, requestedName: removedName, role: agent?.role || process.env.PI_AGENT_ROLE || undefined, cwd: current.cwd, ...identity, sessionFile: current.sessionManager.getSessionFile() || "", model: model(current),thinkingLevel:pi.getThinkingLevel(),configSupport:true,modelCatalog:modelCatalog(current), status: current.isIdle() ? "idle" : "working" }) }); agent = result.agent; removed = false; unavailableCode = ""; removedName = ""; removalNotified = false;lastCatalogAt=Date.now(); uiStatus(); startTimers(); void poll(); }
	async function heartbeat() { if (!id || !ctx || removed) return; if (heartbeatRunning) { heartbeatAgain = true; return; } heartbeatRunning = true; try { const refreshCatalog=Date.now()-lastCatalogAt>60000;agent = (await request<{ agent: Agent }>("/api/heartbeat", { method: "POST", body: JSON.stringify({ agentId: id, status: ["thinking", "working"].includes(activity.value()) ? "working" : "idle", activity: activity.value(), model: model(ctx),thinkingLevel:pi.getThinkingLevel(),configSupport:true,...(refreshCatalog?{modelCatalog:modelCatalog(ctx)}:{}) }) })).agent;if(refreshCatalog)lastCatalogAt=Date.now(); uiStatus(); } catch (cause) { if (cause instanceof MeshRequestError && cause.code === "AGENT_REMOVED") markRemoved(ctx); else if (cause instanceof MeshRequestError && ["MESH_DISABLED", "AGENT_DISABLED", "PROJECT_BLOCKED"].includes(cause.code || "")) markUnavailable(ctx, cause.code!); else ctx.ui.setStatus("agent-mesh", ctx.ui.theme.fg("warning", "mesh:offline")); } finally { heartbeatRunning = false; if (heartbeatAgain) { heartbeatAgain = false; void heartbeat(); } } }
	const incoming = (message: Message) => [`Agent Mesh message #${message.id}`, `From: ${message.fromName}`, `To: ${message.destination.type === "channel" ? `#${message.destination.name}` : message.destination.name}`, `Kind: ${message.kind}`, "", message.content, "", message.fromType === "user" ? "This is a direct user intervention from the Agent Mesh dashboard. Adjust the work accordingly." : `Reply to ${message.fromName} with agent_mesh_send when a response, decision, question, or status update is appropriate.`].join("\n");
	function activateTools() { const active = pi.getActiveTools(); const missing = MESH_TOOLS.filter((name) => !active.includes(name)); if (missing.length) pi.setActiveTools([...new Set([...active, ...missing])]); }
	function pauseOwnedRuns() {
		if(!config||!ctx)return;
		for(const run of listRuns(config.dataDir,canonicalProject(ctx.cwd)).filter(run=>run.parentId===id&&!terminal.has(run.state)))try{enqueueControl(config.dataDir,run.id,'pause')}catch{}
	}
	async function deliver(message: Message) {
		if (!ctx) return;
		updateActivity("receive", message.fromAgentId); activateTools(); const content = incoming(message);
		if (message.fromType === "user") {
			pauseOwnedRuns();
			if(!ctx.isIdle()){
				ctx.abort();const deadline=Date.now()+3000;
				while(!ctx.isIdle()&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25));
				if(!ctx.isIdle())throw new Error('User intervention retained in inbox: current operation has not acknowledged cancellation');
			}
			pi.sendUserMessage(content);
		} else pi.sendMessage({ customType: "agent-mesh", content, display: false, details: message }, { triggerTurn: true, deliverAs: "steer" });
		await request("/api/ack", { method: "POST", body: JSON.stringify({ agentId: id, messageId: message.id }) });
	}
	async function applyPendingConfig(){
		if(configuring||!ctx?.isIdle()||removed)return;
		const {request:pending}=await request<{request?:{id:string;model?:string;thinkingLevel?:string}}>(`/api/agents/config?agentId=${encodeURIComponent(id)}`);
		if(!pending)return;configuring=true;
		let state:'applied'|'failed'='applied',reason='';
		try{
			const available=ctx.modelRegistry.getAvailable(),next=pending.model?available.find(m=>`${m.provider}/${m.id}`===pending.model):ctx.model;
			if(!next)throw new Error('Requested model is unavailable in this Pi session; use /login or /model locally');
			if(pending.thinkingLevel&&!getSupportedThinkingLevels(next).includes(pending.thinkingLevel as never))throw new Error(`Thinking level ${pending.thinkingLevel} is not supported by ${next.provider}/${next.id}`);
			if(pending.model&&pending.model!==model(ctx)&&!await pi.setModel(next))throw new Error('Authentication for requested model is unavailable');
			if(pending.thinkingLevel)pi.setThinkingLevel(pending.thinkingLevel as Parameters<typeof pi.setThinkingLevel>[0]);
			if(pending.thinkingLevel&&pi.getThinkingLevel()!==pending.thinkingLevel)throw new Error('Pi did not apply the requested thinking level');
		}catch(error){state='failed';reason=error instanceof Error?error.message:'Pi rejected the configuration'}
		try{
			await request('/api/agents/config/ack',{method:'POST',body:JSON.stringify({agentId:id,requestId:pending.id,state,model:model(ctx),thinkingLevel:pi.getThinkingLevel(),reason})});
			ctx.ui.notify(state==='applied'?`Mesh configuration applied: ${model(ctx)} · thinking ${pi.getThinkingLevel()}`:`Mesh configuration rejected: ${reason}`,state==='applied'?'info':'warning');
			await heartbeat();
		}finally{configuring=false}
	}
	async function poll() { if (polling || !id || !ctx || removed) return; polling = true; try { await applyPendingConfig();const result = await request<{ messages: Message[] }>(`/api/inbox?agentId=${encodeURIComponent(id)}`); for (const message of result.messages) await deliver(message); if (unavailableCode) void heartbeat(); } catch (cause) { if (cause instanceof MeshRequestError && cause.code === "AGENT_REMOVED") markRemoved(ctx); else if (cause instanceof MeshRequestError && ["MESH_DISABLED", "AGENT_DISABLED", "PROJECT_BLOCKED"].includes(cause.code || "")) markUnavailable(ctx, cause.code!); } finally { polling = false; } }
	function assertAvailable() { if (removed) throw new Error("Agent is disconnected from Agent Mesh. Run /mesh join first."); if (unavailableCode) throw new Error(unavailableCode === "MESH_DISABLED" ? "Agent Mesh is off. Run /mesh on first." : unavailableCode === "PROJECT_BLOCKED" ? "This project is blocked from Agent Mesh." : "This participant is disabled in Agent Mesh."); }
	async function send(input: { to: string; content: string; kind?: MessageKind }, user = false) { assertAvailable(); const result = await request<{ message: Message }>(user ? "/api/user/messages" : "/api/agent/messages", { method: "POST", body: JSON.stringify(user ? { ...input, originAgentId: id } : { agentId: id, ...input }) }); if (!user && ["question", "task"].includes(input.kind || "")) updateActivity("wait", result.message.recipientAgentIds); return result.message; }
	async function channels() { assertAvailable(); return request<{ channels: Channel[] }>(`/api/channels?agentId=${encodeURIComponent(id)}`); }
	async function syncAgent() { agent = (await request<{ agent: Agent }>(`/api/agent?agentId=${encodeURIComponent(id)}`)).agent; uiStatus(); return agent; }
	async function switchChannel(name: string) { assertAvailable(); const result = await request<{ agent: Agent; channels: Channel[]; changed: string[] }>("/api/channels/switch", { method: "POST", body: JSON.stringify({ agentId: id, channel: name.replace(/^#/, "") }) }); agent = result.agent; uiStatus(); return result; }
	async function updateChannels(action: "join" | "leave", names: string[]) { assertAvailable(); const result = await request<{ agent: Agent; channels: Channel[]; changed: string[] }>(`/api/channels/${action}`, { method: "POST", body: JSON.stringify({ agentId: id, channels: names }) }); agent = result.agent; uiStatus(); return result; }

	// Keep coordination in model context and the dashboard, including restored sessions.
	pi.registerMessageRenderer("agent-mesh", () => new Container());
	const dashboardOnly = { renderShell: "self" as const, renderCall: () => new Container(), renderResult: () => new Container() };
	pi.registerTool({ ...dashboardOnly, name: "agent_mesh_send", label: "Agent Mesh Send", description: "Send to a peer in your selected project channel, the selected #channel, or * for peers there. To reply to the user, send to #user; that reply is dashboard-only and is never delivered to other agents.", promptSnippet: "Coordinate directly with other active Pi agents", promptGuidelines: ["Use agent_mesh_send for all cross-agent replies, questions, plans, decisions, dependencies, and completion evidence."], parameters: Type.Object({ to: Type.String({ description: "Peer name/ID, selected #channel, * for peers there, or #user for a dashboard-only reply to the user" }), message: Type.String({ minLength: 1, maxLength: 20_000 }), kind: Type.Optional(StringEnum(["message", "question", "plan", "task", "decision", "status"] as const)) }), async execute(_call, params) { const item = await send({ to: params.to, content: params.message, kind: params.kind }); const destination = item.destination.type === "channel" ? `#${item.destination.name}` : item.destination.name; return { content: [{ type: "text", text: `Sent message #${item.id} to ${destination}.` }], details: { message: item } }; } });
	pi.registerTool({ name: "agent_mesh_agents", label: "Agent Mesh Agents", description: "List only peers with the same active channel, including names, projects, models, memberships, and presence.", promptSnippet: "List agents available for coordination", parameters: Type.Object({}), async execute() { const result = await request<{ agents: Agent[] }>(`/api/agents?agentId=${encodeURIComponent(id)}`); const lines = result.agents.sort((a, b) => a.name.localeCompare(b.name)).map((item) => `- ${item.name} [${item.status}${item.enabled ? "" : ", disabled"}] — ${item.cwd} — role:${item.role||'orchestrator'} — project:${item.projectName} ${item.projectHash.slice(0, 12)}${item.model ? ` — ${item.model}` : ""} — active: ${item.activeChannel ? `#${item.activeChannel}` : "none"} — channels: ${item.channels.map((name) => `#${name}`).join(", ") || "none"}`); return { content: [{ type: "text", text: lines.join("\n") || "No agents currently have the same active channel as you." }], details: result }; } });
	pi.registerTool({ ...dashboardOnly, name: "agent_mesh_history", label: "Agent Mesh History", description: "Read active-channel history and your direct administrator interventions, optionally filtered by agent/channel. Output capped at 50KB.", promptSnippet: "Review prior cross-agent discussions", parameters: Type.Object({ agent: Type.Optional(Type.String()), channel: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }), async execute(_call, params) { const limit = params.limit ?? 20; const result = await request<{ messages: Message[] }>(`/api/messages?agentId=${encodeURIComponent(id)}&before=9007199254740991&limit=${Math.max(100, limit * 5)}`); const agentValue = params.agent?.trim(), agentFilter = agentValue?.toLowerCase(), channelFilter = params.channel?.replace(/^#/, "").toLowerCase(); const selected = result.messages.filter((item) => !agentFilter || item.fromName.toLowerCase() === agentFilter || item.destination.name.toLowerCase() === agentFilter || item.fromAgentId === agentValue || item.destination.id === agentValue).filter((item) => !channelFilter || ((item.scopeChannel || (item.destination.type === "channel" ? item.destination.name : "")).toLowerCase() === channelFilter)).slice(-limit); const output = selected.map((item) => `#${item.id} ${item.timestamp} ${item.scopeChannel || item.destination.type === "channel" ? `[#${item.scopeChannel || item.destination.name}]` : ""} ${item.fromName} → ${item.destination.name} (${item.kind})\n${item.content}`).join("\n\n") || "No matching messages."; const truncated = truncateHead(output, { maxBytes: 50 * 1024, maxLines: 2000 }); return { content: [{ type: "text", text: truncated.content + (truncated.truncated ? "\n\n[History truncated.]" : "") }], details: { messages: selected, truncated: truncated.truncated } }; } });
	pi.registerTool({ name: "agent_mesh_channels", label: "Agent Mesh Channels", description: "List channels, join/create memberships, leave memberships, or switch the active channel. Joining activates the first requested channel; switch requires exactly one existing channel and joins it if needed. Do not switch away from the user's chosen channel without an explicit request.", promptSnippet: "Manage membership and the active coordination channel", parameters: Type.Object({ action: StringEnum(["list", "join", "leave", "switch"] as const), channels: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 20 })) }), async execute(_call, params) {
		if (params.action === "list") { const result = await channels(); return { content: [{ type: "text", text: result.channels.map(channel => `${channel.active ? "★" : channel.joined ? "●" : "○"} #${channel.name}${channel.active ? " (active)" : ""} (${channel.memberCount})`).join("\n") || "No channels." }], details: result }; }
		if (!params.channels?.length) throw new Error(`channels is required for ${params.action}`);
		if (params.action === "switch" && params.channels.length !== 1) throw new Error("Switch requires exactly one channel.");
		const result = params.action === "switch" ? await switchChannel(params.channels[0]) : await updateChannels(params.action, params.channels.map(name => name.replace(/^#/, "")));
		return { content: [{ type: "text", text: `${params.action}: ${result.changed.map(name => `#${name}`).join(", ") || "no membership changes"}. Active: ${result.agent.activeChannel ? `#${result.agent.activeChannel}` : "none"}.` }], details: result };
	} });

	pi.registerTool({name:'agent_mesh_tasks',label:'Mesh project tasks',description:'Project Kanban. Orchestrators create Backlog tasks and refine them to To Do. Approved runners claim their frozen tasks exclusively, move In Progress → Testing → Done with passing evidence. Read comments, answer blockers or comment to steer. Board tasks alone never authorize worker execution.',parameters:Type.Object({action:StringEnum(['list','create','refine','ready','comment','answer','escalate'] as const),id:Type.Optional(Type.String()),version:Type.Optional(Type.Integer()),title:Type.Optional(Type.String()),description:Type.Optional(Type.String()),profile:Type.Optional(Type.String()),message:Type.Optional(Type.String())}),async execute(_call,params){assertAvailable();const result=await request('/api/tasks'+(params.action==='list'?`?agentId=${encodeURIComponent(id)}`:''),params.action==='list'?{}:{method:'POST',body:JSON.stringify({...params,agentId:id})});return{content:[{type:'text',text:JSON.stringify(result).slice(-48000)}],details:result}}});

	const renameCurrentAgent = async (rawName: string, current: ExtensionContext) => { const force = /(?:^|\s)(?:--force|-f)(?=\s|$)/i.test(rawName), value = rawName.replace(/(?:^|\s)(?:--force|-f)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim(); if (!value) return current.ui.notify(agent ? `Agent Mesh name: ${agent.name}` : "Not registered", "info"); const result = await request<{ agent: Agent; displaced?: Agent }>("/api/rename", { method: "POST", body: JSON.stringify({ agentId: id, name: value, force }) }); agent = result.agent; uiStatus(); current.ui.notify(result.displaced ? `Agent Mesh name set to ${agent.name}; disconnected previous holder ${result.displaced.name}.` : `Agent Mesh name set to ${agent.name}`, "info"); };
	const showRegisteredAgents = async (current: ExtensionContext) => { const result = await request<{ agents: Agent[] }>(`/api/agents?agentId=${encodeURIComponent(id)}`); current.ui.notify(result.agents.map((item) => `${item.name} [${item.status}${item.enabled ? "" : ", disabled"}] ${item.projectName}:${item.projectHash.slice(0, 12)} active:#${item.activeChannel} joined:#${item.channels.join(" #")}`).join(", ") || "No agents currently have the same active channel as you.", "info"); };
	const showChannels = async (current: ExtensionContext) => { const result = await channels(); const lines = result.channels.map(channel => current.ui.theme.fg(channel.active ? "accent" : channel.joined ? "success" : "dim", `${channel.active ? "★" : channel.joined ? "●" : "○"} #${channel.name}${channel.active ? " (active)" : ""} (${channel.memberCount} members)`)); current.ui.notify(lines.join("\n") || "No channels", "info"); };
	async function readCurrentAgent(current: ExtensionContext, allowRemoved = false) {
		if (removed && allowRemoved) return;
		try { await syncAgent(); }
		catch (cause) { if (allowRemoved && cause instanceof MeshRequestError && cause.code === "AGENT_REMOVED") markRemoved(current); else throw cause; }
	}
	const changeChannels = async (action: "join" | "leave", values: string[], current: ExtensionContext) => {
		await readCurrentAgent(current, action === "join");
		if (removed && action === "join") await rejoin(current);
		const requested = values.map(name => name.replace(/^#/, ""));
		if (!requested.length) return current.ui.notify("This agent is not joined to any channels.", "info");
		const result = await updateChannels(action, requested);
		current.ui.notify(`${action === "join" ? "Joined" : "Left"}: ${result.changed.map(name => `#${name}`).join(", ") || "no membership changes"}. Active: ${result.agent.activeChannel ? `#${result.agent.activeChannel}` : "none"}.`, "info");
	};
	let channelPickerOpen = false;
	async function pickChannel(action: "join" | "switch" | "leave", current: ExtensionContext) {
		if (!current.hasUI) return current.ui.notify(`Use /mesh ${action} <channel> in non-interactive mode.`, "warning");
		if (channelPickerOpen) return current.ui.notify("A channel picker is already open.", "warning");
		channelPickerOpen = true;
		try {
			await readCurrentAgent(current, action === "join");
			const result = removed ? await request<{ channels: Channel[] }>("/api/channels") : await channels();
			const available = result.channels.filter(channel => !channel.userOnly && (action !== "leave" || channel.joined));
			if (action === "leave" && available.length === 0) return current.ui.notify("This agent is not joined to any channels.", "info");
			if (action === "leave" && available.length === 1) return await changeChannels("leave", [available[0].name], current);
			// Pi's native select initially focuses the first option. Put the active channel first.
			available.sort((a,b) => Number(b.active)-Number(a.active) || a.name.localeCompare(b.name));
			const choices = available.map(channel => ({ name: channel.name, label: `#${channel.name}${channel.active ? " (active)" : channel.joined ? " (joined)" : ""}` }));
			const extra = action === "join" ? "Create a new channel…" : action === "leave" ? "All channels" : null;
			const selected = await current.ui.select(action === "leave" ? "Leave a channel" : action === "switch" ? "Switch active channel" : "Join a channel", [...choices.map(choice => choice.label), ...(extra ? [extra] : [])]);
			if (selected === undefined) return;
			if (action === "join" && selected === extra) {
				const name = (await current.ui.input("Create a new channel", "channel-name"))?.trim().replace(/^#/, "");
				if (!name) return;
				if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u.test(name)) return current.ui.notify("Use 1–64 letters, numbers, dots, underscores, or hyphens; start with a letter or number.", "warning");
				return await changeChannels("join", [name], current);
			}
			if (action === "leave" && selected === extra) { await readCurrentAgent(current); return await changeChannels("leave", [...(agent?.channels || [])], current); }
			const choice = choices.find(item => item.label === selected); if (!choice) return;
			if (action === "switch") { const switched = await switchChannel(choice.name); current.ui.notify(`Active channel: #${switched.agent.activeChannel}`, "info"); }
			else await changeChannels(action, [choice.name], current);
		} finally { channelPickerOpen = false; }
	}
	const sendUserIntervention = async (to: string, content: string, current: ExtensionContext) => { if (!to.trim() || !content.trim()) return current.ui.notify("Usage: /mesh @<agent> <message>", "warning"); const item = await send({ to: to.trim(), content: content.trim(), kind: "steer" }, true); const destination = item.destination.type === "channel" ? `#${item.destination.name}` : item.destination.name; current.ui.notify(`Sent user intervention #${item.id} to ${destination}`, "info"); };
	const sendChannelIntervention = async (raw: string, current: ExtensionContext) => { const separator = raw.indexOf(" "); if (separator < 2) return current.ui.notify("Usage: /mesh #<channel> <message>", "warning"); return sendUserIntervention(raw.slice(0, separator), raw.slice(separator + 1), current); };
	const sendAddressedIntervention = async (raw: string, current: ExtensionContext) => { const addressed = raw.slice(1).trim(); if (!addressed) return current.ui.notify("Usage: /mesh @<agent> <message>", "warning"); const result = await request<{ agents: Agent[] }>("/api/agents"); const target = result.agents.flatMap((item) => [{ value: item.name, item }, { value: item.id, item }]).sort((a, b) => b.value.length - a.value.length).find(({ value }) => addressed.toLowerCase().startsWith(`${value.toLowerCase()} `)); if (target) return sendUserIntervention(target.item.id, addressed.slice(target.value.length).trim(), current); const separator = addressed.indexOf(" "); if (separator < 1) return current.ui.notify("Usage: /mesh @<agent> <message>", "warning"); return sendUserIntervention(addressed.slice(0, separator), addressed.slice(separator + 1), current); };
	const setGlobalEnabled = async (enabled: boolean, current: ExtensionContext) => { await request("/api/policy/global", { method: "POST", body: JSON.stringify({ enabled }) }); if (!enabled) markUnavailable(current, "MESH_DISABLED"); else if (!removed) { unavailableCode = ""; await heartbeat(); } current.ui.notify(`Agent Mesh is ${enabled ? "on" : "off"} for all agents.`, enabled ? "info" : "warning"); };
	const openMeshPage = async (action: "dashboard" | "help", current: ExtensionContext) => { try { await broker(); } catch (cause) { let live = await probe(1000); for (let attempt = 0; attempt < 4 && !live?.ok; attempt++) { await new Promise((done) => setTimeout(done, 250)); live = await probe(1000); } if (!live?.ok || live.instance !== fingerprint()) throw cause; } const authPath = action === "help" ? "/auth/help" : "/auth"; open(`${base()}${authPath}?token=${encodeURIComponent(config!.token)}`); current.ui.notify(action === "help" ? "Opened Agent Mesh documentation" : `Opened ${base()}`, "info"); };

	const workCommand = registerWork(pi, () => config!.dataDir, async () => { assertAvailable(); await syncAgent(); }, () => ({base:base(),token:config!.token}));
	pi.registerCommand("mesh", { description: "Configure a team in Pi: change settings, cancel, or accept", getArgumentCompletions: (prefix) => { const value = prefix.trimStart().toLowerCase(); const items = [{ value: "role", label: "role · set role and project-based name" }, { value: "jobs", label: "jobs · role profiles, delegation and job control" }, { value: "team", label: "team · completion-driven team for your request" }, { value: "demo", label: "demo · approved no-tools test, e.g. demo 22" }, { value: "doctor", label: "doctor · read-only setup and failure checks" }, { value: "config", label: "config · inline project settings (Cancel / Save)" }, { value: "configure", label: "configure · choose a participant model and thinking level" }, { value: "dashboard", label: "dashboard" }, { value: "help", label: "help" }, { value: "version", label: "version" }, { value: "name", label: "name" }, { value: "agents", label: "agents" }, { value: "channels", label: "channels" }, { value: "join", label: "join" }, { value: "switch", label: "switch" }, { value: "leave", label: "leave" }, { value: "on", label: "on" }, { value: "off", label: "off" }, { value: "rejoin", label: "rejoin" }, { value: "@", label: "@<agent>" }, { value: "#", label: "#<channel>" }].filter((item) => value ? item.value.startsWith(value) : ['team','demo','config','jobs','dashboard','help'].includes(item.value)); return items.length ? items : null; }, handler: async (args, current) => {
		try {
		const raw = args.trim(), lowered = raw.toLowerCase(), [command, ...rest] = raw.split(/\s+/);
		if (!raw) return await workCommand('team', current);
		if (lowered === "dashboard") return await openMeshPage("dashboard", current);
		if (lowered === "help") return await openMeshPage("help", current);
		if (lowered === 'config') {const saved=await editProjectConfig(current);return current.ui.notify(saved?`Saved ${saved}. Future approvals use these settings; running jobs unchanged.`:'Configuration cancelled — no changes.', 'info');}
		if (lowered === "version") return current.ui.notify(`Agent Mesh v${VERSION}`, "info");
		if (lowered === 'doctor') {
			const result=await diagnoseMesh({configPath,version:VERSION,project:canonicalProject(current.cwd),model:model(current),agent});
			return current.ui.notify(result.checks.map(check=>`${check.status} ${check.name}: ${check.detail}`).join('\n'),result.ok?'info':'warning');
		}
		if (command?.toLowerCase() === 'demo') return await workCommand(raw,current);
		if (command?.toLowerCase() === 'jobs') return await workCommand(raw.slice(4).trim(), current);
        if (['steer','pause','continue','stop'].includes(command?.toLowerCase())) return await workCommand(raw,current);
		if (command?.toLowerCase() === 'team') {
			return await workCommand('team '+raw.slice(4).trim(), current);
		}
		if (!agent && !removed && !unavailableCode) { await register(current); startTimers(); }
		if (command?.toLowerCase() === 'configure') {
			if(!current.hasUI)return current.ui.notify('Use the dashboard Configure agent tab or run /mesh configure <agent> in interactive Pi.','warning');
			const all=await request<{agents:Agent[]}>('/api/agents');const targetName=rest.join(' ').trim();
			const chosen=targetName||await current.ui.select('Configure agent',all.agents.filter(a=>a.configurable).map(a=>a.name));if(!chosen)return;
			const target=all.agents.find(a=>a.id===chosen||a.name.toLowerCase()===chosen.toLowerCase());if(!target?.configurable)return current.ui.notify('Agent is offline, an immutable child job, or needs /reload before configuration.','warning');
			const catalog=await request<{models:{id:string;levels:string[]}[]}>('/api/agents/config?agentId='+encodeURIComponent(target.id)+'&catalog=1');
			const choice=await current.ui.select(`Model for ${target.name}`,[`Keep current (${target.model||'none'})`,...catalog.models.map(m=>m.id),'Enter exact provider/model ID…']);if(!choice)return;
			const selectedModel=choice==='Enter exact provider/model ID…'?(await current.ui.input('Exact provider/model ID','provider/model-id'))?.trim():choice.startsWith('Keep current')?undefined:choice;
			if(choice==='Enter exact provider/model ID…'&&!selectedModel)return;
			const levels=catalog.models.find(m=>m.id===(selectedModel||target.model))?.levels||['off','minimal','low','medium','high','xhigh','max'];
			const thinkingLevel=await current.ui.select(`Thinking level for ${target.name}`,[`Keep current (${target.thinkingLevel||'unknown'})`,...levels]);if(!thinkingLevel)return;
			if(!selectedModel&&thinkingLevel.startsWith('Keep current'))return current.ui.notify('No configuration change requested.','info');
			const requested=await request<{request:{id:string}}>('/api/agents/config',{method:'POST',body:JSON.stringify({agentId:target.id,...(selectedModel?{model:selectedModel}:{}),...(thinkingLevel.startsWith('Keep current')?{}:{thinkingLevel})})});
			return current.ui.notify(`Configuration queued for ${target.name} (#${requested.request.id}). Check its receipt in the dashboard; queued is not applied.`, 'info');
		}
		if (command?.toLowerCase() === 'role') {
			const role=rest.join(' ').trim()||(current.hasUI?await current.ui.select('Agent role',['orchestrator','developer','tester','reviewer','architect','scout','researcher','advisor','auditor']):undefined);
			if(!role)return current.ui.notify('Usage: /mesh role <role>','info');
			const result=await request<{agent:Agent}>('/api/agents/role',{method:'POST',body:JSON.stringify({agentId:id,role})});agent=result.agent;uiStatus();return current.ui.notify(`Mesh role: ${agent.role} · ${agent.name}`,'info');
		}
		if (lowered === "name") return await renameCurrentAgent("", current);
		if (lowered.startsWith("name ")) return await renameCurrentAgent(raw.slice(raw.indexOf(" ") + 1), current);
		if (lowered === "agents") return await showRegisteredAgents(current);
		if (lowered === "channels") return await showChannels(current);
		if (lowered === "on") return await setGlobalEnabled(true, current);
		if (lowered === "off") return await setGlobalEnabled(false, current);
		if (command?.toLowerCase() === "join" && rest.length) return await changeChannels("join", rest, current);
		if (lowered === "join") return await pickChannel("join", current);
		if (lowered === "switch") return await pickChannel("switch", current);
		if (command?.toLowerCase() === "switch" && rest.length) { if (rest.length !== 1) return current.ui.notify("Usage: /mesh switch <channel>", "warning"); const result = await switchChannel(rest[0]); return current.ui.notify(`Active channel: #${result.agent.activeChannel}`, "info"); }
		if (lowered === "rejoin") { await readCurrentAgent(current, true); if (!removed) return current.ui.notify("This agent is already registered. Use /mesh join to select a channel.", "info"); await rejoin(current); return current.ui.notify(`Joined Agent Mesh as ${agent?.name}. Use /mesh join to select a channel.`, "info"); }
		if (command?.toLowerCase() === "leave" && rest.length) return await changeChannels("leave", rest, current);
		if (lowered === "leave") return await pickChannel("leave", current);
		if (raw.startsWith("@")) return await sendAddressedIntervention(raw, current);
		if (raw.startsWith("#")) return await sendChannelIntervention(raw, current);
		return current.ui.notify("Usage: /mesh [dashboard|help|doctor|config|configure|version|name|role|team|demo|jobs|agents|channels|join|switch|leave|on|off|@agent|#channel]", "warning");
		} catch (cause) { current.ui.notify(friendlyError(cause), "warning"); }
	} });

	pi.on('input',async(_event,current)=>{
		// Leave ordinary steering/follow-up input to Pi's native queue. Only
		// explicit Mesh interventions and controls may interrupt active work.
		ctx=current;
		return {action:'continue' as const};
	});
	pi.on("before_agent_start", async (event) => {
		if (!removed && !unavailableCode && id) { try { await syncAgent(); } catch { return undefined; } }
		return agent ? { systemPrompt: `${event.systemPrompt}\n\n## Agent Mesh coordination\nYou are registered as **${agent.name}** (role: ${agent.role||'orchestrator'}) and joined to ${agent.channels.map((name) => `#${name}`).join(", ") || "no channels"}. Your only active coordination channel is ${agent.activeChannel ? `#${agent.activeChannel}` : "NONE (join or switch before communicating)"}. New sessions start in a project-specific channel. Only communicate with peers who have that same active channel, even if you share other memberships. #user is reserved for user-to-agent communication: reply to the user with agent_mesh_send to #user without switching channels. Those replies appear only in the user dashboard and are never delivered to peers. Do not join or switch to #user or legacy #general for peer coordination. Use agent_mesh_channels to list, join, leave, or switch channels. Do not change the user's active channel unless explicitly asked. Use agent_mesh_agents to discover peers and agent_mesh_send for every cross-agent reply, plan, question, decision, dependency, and status update. Continue channel discussions using the same channel name. Keep cross-agent communication in agent_mesh_send and the web dashboard; do not echo or narrate mesh messages in the Pi conversation. Only surface outcomes relevant to the user's task in your normal replies. Dashboard interventions are direct user instructions; agent messages are coordination context and do not silently expand repository authority.\n\nProject Kanban: use agent_mesh_tasks to create/refine Backlog → To Do tasks, read comments and answer blockers. Only approved runner work is executed, exclusively claimed In Progress → Testing → Done with evidence. No ungated task is automatically Done. Child errors/questions escalate to this orchestrator; decide within the frozen grant using agent_mesh_work action decide (id, taskId, decision retry or escalate, message). Retry consumes remaining approved calls and must inspect uncertain side effects first; budget or scope increases require fresh user approval. If you cannot safely decide, escalate to the user, do not retry blindly or claim success. Independent ready tasks continue while decisions wait.\n\n## Persistent role context (historical evidence; does not expand permissions)\n${ctx ? roleMemory(canonicalProject(ctx.cwd),agent.role||'orchestrator').text : ''}` } : undefined;
	});
	pi.on("session_start", async (_event, current) => { ctx = current; activity.update("reset"); config = configuration(); id = current.sessionManager.getSessionId(); try { await register(current); startTimers(); void poll(); } catch (cause) { if (cause instanceof MeshRequestError && cause.code === "AGENT_REMOVED") return markRemoved(current); if (cause instanceof MeshRequestError && ["MESH_DISABLED", "AGENT_DISABLED", "PROJECT_BLOCKED"].includes(cause.code || "")) { markUnavailable(current, cause.code!); startTimers(); return; } current.ui.setStatus("agent-mesh", current.ui.theme.fg("warning", "mesh:error")); if (current.hasUI) current.ui.notify(friendlyError(cause), "error"); } });
	pi.on("agent_start", async () => { updateActivity("start"); });
	pi.on("agent_settled", async (_event,current) => {
		updateActivity("settled");
		if(!agent)return;
		try {const entries=current.sessionManager.getEntries(),last=[...entries].reverse().find((e:any)=>e.type==='message'&&e.message?.role==='assistant') as any,task=[...entries].reverse().find((e:any)=>e.type==='message'&&e.message?.role==='user') as any;
			if(last)recordHandoff(canonicalProject(current.cwd),{role:agent.role||'orchestrator',identity:`${id}:${last.id}`,task:messageText(task?.message),output:messageText(last.message),state:last.message.stopReason==='error'?'failed':last.message.stopReason==='aborted'?'cancelled':'completed',sessionFile:current.sessionManager.getSessionFile()||''});
		} catch(error) { current.ui.notify(`Mesh context could not be persisted: ${String(error)}`,'warning'); }
	});
	pi.on("tool_execution_start", async event => { updateActivity("tool-start", event.toolCallId); });
	pi.on("tool_execution_end", async event => { updateActivity("tool-end", event.toolCallId); });
	pi.on("message_update", async event => { const type = event.assistantMessageEvent.type; if (type === "thinking_start") updateActivity("phase", "thinking"); else if (type === "text_start") updateActivity("phase", "working"); }); pi.on("model_select", async (_event, current) => { ctx = current; void heartbeat(); });
	pi.on("session_shutdown", async () => { stopTimers(); if (id) try { await request("/api/offline", { method: "POST", body: JSON.stringify({ agentId: id }) }); } catch { /* shutdown */ } if (ctx) { ctx.ui.setStatus("agent-mesh", undefined); ctx.ui.setWidget("agent-mesh", undefined); } ctx = undefined; agent = undefined; id = ""; });
}
