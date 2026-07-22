import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2.1.1";
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 20_000;
const MAX_CHANNEL = 64;
const ONLINE_MS = 20_000;
const DEFAULT_CHANNEL = "general";
const extensionDir = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(process.argv[2] || process.env.PI_AGENT_MESH_CONFIG || join(extensionDir, "config.json"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const host = config.host === "127.0.0.1" ? config.host : "127.0.0.1";
const port = Number(config.port);
const token = String(config.token || "");
const dataDir = resolve(String(config.dataDir));
if (!Number.isInteger(port) || port < 1024 || port > 65535 || token.length < 32) throw new Error("Invalid Agent Mesh config");
mkdirSync(dataDir, { recursive: true });
const origin = `http://${host}:${port}`;
const instance = createHash("sha256").update(token).digest("hex").slice(0, 16);
const messagesFile = join(dataDir, "messages.jsonl");
const agentsFile = join(dataDir, "agents.json");
const channelsFile = join(dataDir, "channels.json");

function readObject(path) {
	if (!existsSync(path)) return null;
	try { const value = JSON.parse(readFileSync(path, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
	catch { return null; }
}
function recoverObject(path) {
	const primary = readObject(path);
	if (primary) return primary;
	const backup = `${path}.bak`, recovered = readObject(backup);
	if (!recovered) return {};
	try { if (existsSync(path)) rmSync(path, { force: true }); renameSync(backup, path); } catch { /* keep recovered state in memory */ }
	return recovered;
}
function atomic(path, value) {
	const temp = `${path}.${process.pid}.tmp`, backup = `${path}.bak`;
	writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
	try { if (existsSync(backup)) rmSync(backup, { force: true }); if (existsSync(path)) renameSync(path, backup); renameSync(temp, path); if (existsSync(backup)) rmSync(backup, { force: true }); }
	catch (cause) { if (!existsSync(path) && existsSync(backup)) renameSync(backup, path); if (existsSync(temp)) rmSync(temp, { force: true }); throw cause; }
}
function clean(value, field, max, empty = false) {
	const result = String(value ?? "").trim();
	if ((!empty && !result) || result.length > max || result.includes("\0")) throw Object.assign(new Error(`${field} is invalid`), { status: 400, code: "INVALID_INPUT" });
	return result;
}
function cleanAgentName(value) {
	const name = clean(value, "name", 48).replace(/\s+/g, " ");
	if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) throw Object.assign(new Error("Invalid agent name"), { status: 400, code: "INVALID_AGENT_NAME" });
	return name;
}
function cleanChannelName(value) {
	const name = clean(value, "channel", MAX_CHANNEL);
	if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(name)) throw Object.assign(new Error(`Invalid channel name: ${name}`), { status: 400, code: "INVALID_CHANNEL_NAME" });
	return name;
}
function migrateChannelName(value) {
	const normalized = String(value || "imported-general").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, MAX_CHANNEL);
	return normalized || "imported-general";
}
const key = (value) => String(value).trim().toLocaleLowerCase("en-US");

let agents = recoverObject(agentsFile);
let channelStore = recoverObject(channelsFile);
function ensureChannel(value, createdBy = "system") {
	const requested = cleanChannelName(value || DEFAULT_CHANNEL), channelKey = key(requested), existing = channelStore[channelKey];
	if (existing) { if (existing.closedAt) throw Object.assign(new Error(`Channel #${existing.name} is closed`), { status: 410, code: "CHANNEL_CLOSED" }); return existing; }
	const channel = { name: requested, createdAt: new Date().toISOString(), createdBy };
	channelStore[channelKey] = channel;
	return channel;
}
ensureChannel(DEFAULT_CHANNEL);

for (const agent of Object.values(agents)) {
	const requested = Array.isArray(agent.channels) ? agent.channels : [DEFAULT_CHANNEL];
	agent.channels = [...new Set(requested.map((name) => ensureChannel(name, "migration").name))];
}
const messages = [];
let migratedMessages = false;
if (existsSync(messagesFile)) for (const line of readFileSync(messagesFile, "utf8").split(/\r?\n/)) {
	if (!line.trim()) continue;
	try {
		const value = JSON.parse(line);
		if (!Number.isInteger(value?.id)) continue;
		if (value.destination && Array.isArray(value.recipientAgentIds)) { messages.push(value); continue; }
		const channel = ensureChannel(migrateChannelName(value.channel || value.threadId), "migration");
		const recipients = value.toAgentId ? [value.toAgentId] : value.broadcast ? Object.keys(agents).filter((agentId) => agentId !== value.fromAgentId) : [];
		for (const memberId of [value.fromAgentId, ...recipients].filter(Boolean)) { const member = agents[memberId]; if (member && !member.channels.some((name) => key(name) === key(channel.name))) member.channels.push(channel.name); }
		const migrated = { id: value.id, messageId: value.messageId || randomBytes(12).toString("hex"), timestamp: value.timestamp, fromType: value.fromType, fromAgentId: value.fromAgentId || null, fromName: value.fromName, destination: { type: "channel", id: channel.name, name: channel.name }, recipientAgentIds: [...new Set(recipients)].sort(), kind: value.kind, content: value.content };
		messages.push(migrated); migratedMessages = true;
	} catch { /* tolerate interrupted or malformed transcript lines */ }
}
if (migratedMessages) writeFileSync(messagesFile, messages.map((item) => JSON.stringify(item)).join("\n") + (messages.length ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
let nextId = messages.reduce((max, item) => Math.max(max, item.id), 0) + 1;
atomic(channelsFile, channelStore);
if (Object.keys(agents).length) atomic(agentsFile, agents);

const persistAgents = () => atomic(agentsFile, agents);
const persistChannels = () => atomic(channelsFile, channelStore);
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };
const cookies = (header = "") => Object.fromEntries(header.split(";").map((part) => { const i = part.indexOf("="); return i < 0 ? ["", ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }).filter(([cookieKey]) => cookieKey));
const authenticated = (request) => { const auth = String(request.headers.authorization || ""); return (auth.startsWith("Bearer ") && equal(auth.slice(7), token)) || equal(cookies(request.headers.cookie).mesh_session || "", token); };
const headers = (extra = {}) => ({
	"Cache-Control": "no-store",
	"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
	"Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", ...extra,
});
const json = (response, status, value) => { response.writeHead(status, headers({ "Content-Type": "application/json; charset=utf-8" })); response.end(JSON.stringify(value)); };
const text = (response, status, type, value, extra = {}) => { response.writeHead(status, headers({ "Content-Type": type, ...extra })); response.end(value); };
const error = (response, status, code, message) => json(response, status, { error: { code, message } });

async function body(request) {
	if (String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase() !== "application/json") throw Object.assign(new Error("JSON body required"), { status: 415, code: "JSON_REQUIRED" });
	let size = 0; const chunks = [];
	for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413, code: "BODY_TOO_LARGE" }); chunks.push(chunk); }
	try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
	catch { throw Object.assign(new Error("Valid JSON object required"), { status: 400, code: "INVALID_JSON" }); }
}
function mutationOrigin(request) { if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error("Request origin is not allowed"), { status: 403, code: "ORIGIN_NOT_ALLOWED" }); }
function activeAgents() { return Object.values(agents).filter((item) => !item.removedAt); }
function findAgent(value) { return activeAgents().find((item) => item.id === value || key(item.name) === key(value)); }
function availableAgentName(name, except) { if (Object.values(agents).some((item) => item.id !== except && key(item.name) === key(name))) throw Object.assign(new Error(`Agent name is already in use: ${name}`), { status: 409, code: "AGENT_NAME_TAKEN" }); }
function publicAgent(item) {
	return { id: item.id, name: item.name, cwd: item.cwd, sessionFile: item.sessionFile || null, model: item.model || null, status: Date.now() - Number(item.lastSeenAt || 0) <= ONLINE_MS && item.status !== "offline" ? item.status : "offline", lastSeenAt: item.lastSeenAt, registeredAt: item.registeredAt, lastAck: Number(item.lastAck || 0), generation: Number(item.generation || 1), channels: [...(item.channels || [])].sort((a, b) => a.localeCompare(b)) };
}
function publicChannels(agentId) {
	const joinedKeys = new Set((agents[agentId]?.channels || []).map(key));
	return Object.values(channelStore).filter((channel) => !channel.closedAt).map((channel) => {
		const members = activeAgents().filter((agent) => (agent.channels || []).some((name) => key(name) === key(channel.name)));
		return { ...channel, joined: joinedKeys.has(key(channel.name)), memberIds: members.map((member) => member.id), memberNames: members.map((member) => member.name).sort((a, b) => a.localeCompare(b)), memberCount: members.length };
	}).sort((a, b) => a.name.localeCompare(b.name));
}
function updateMembership(agentId, names, action) {
	const agent = agents[agentId];
	if (!agent) throw Object.assign(new Error("Agent is not registered"), { status: 404, code: "AGENT_NOT_FOUND" });
	if (agent.removedAt) throw Object.assign(new Error("Agent was removed and must explicitly rejoin"), { status: 410, code: "AGENT_REMOVED" });
	if (!Array.isArray(names) || names.length === 0) throw Object.assign(new Error("At least one channel is required"), { status: 400, code: "INVALID_CHANNELS" });
	const requestedNames = names.map(cleanChannelName);
	if (action === "leave") for (const requested of requestedNames) if (!channelStore[key(requested)]) throw Object.assign(new Error(`Unknown channel: ${requested}`), { status: 404, code: "CHANNEL_NOT_FOUND" });
	const current = new Map((agent.channels || []).map((name) => [key(name), name]));
	const changed = [];
	for (const requested of requestedNames) {
		if (action === "join") { const channel = ensureChannel(requested, agent.id); if (!current.has(key(channel.name))) { current.set(key(channel.name), channel.name); changed.push(channel.name); } }
		else { const channel = channelStore[key(requested)]; if (current.delete(key(channel.name))) changed.push(channel.name); }
	}
	agent.channels = [...current.values()].sort((a, b) => a.localeCompare(b));
	agent.lastSeenAt = Date.now();
	persistChannels(); persistAgents();
	return { agent: publicAgent(agent), channels: publicChannels(agentId), changed };
}
function appendMessage(input) {
	const targetText = clean(input.to ?? "*", "to", 160);
	let destination, recipients;
	if (targetText.startsWith("#")) {
		const requested = cleanChannelName(targetText.slice(1)), channel = channelStore[key(requested)];
		if (!channel) throw Object.assign(new Error(`Unknown channel: ${requested}`), { status: 404, code: "CHANNEL_NOT_FOUND" });
		if (channel.closedAt) throw Object.assign(new Error(`Channel #${channel.name} is closed`), { status: 410, code: "CHANNEL_CLOSED" });
		if (input.fromAgent && !input.fromAgent.channels.some((name) => key(name) === key(channel.name))) throw Object.assign(new Error(`Join #${channel.name} before sending to it`), { status: 403, code: "CHANNEL_MEMBERSHIP_REQUIRED" });
		destination = { type: "channel", id: channel.name, name: channel.name };
		recipients = activeAgents().filter((agent) => agent.id !== input.fromAgent?.id && agent.channels.some((name) => key(name) === key(channel.name))).map((agent) => agent.id);
	} else if (targetText === "*" || ["all", "broadcast"].includes(key(targetText))) {
		destination = { type: "all", id: null, name: "All agents" };
		recipients = activeAgents().map((agent) => agent.id).filter((agentId) => agentId !== input.fromAgent?.id);
	} else {
		const target = findAgent(targetText);
		if (!target) throw Object.assign(new Error(`Unknown agent: ${targetText}`), { status: 404, code: "AGENT_NOT_FOUND" });
		destination = { type: "agent", id: target.id, name: target.name };
		recipients = [target.id];
	}
	recipients = [...new Set(recipients)].sort();
	if (destination.type === "channel" && recipients.length === 0) throw Object.assign(new Error(`Channel #${destination.name} has no recipients`), { status: 409, code: "CHANNEL_HAS_NO_RECIPIENTS" });
	const kind = ["message", "question", "plan", "task", "decision", "status", "steer"].includes(input.kind) ? input.kind : "message";
	const item = { id: nextId++, messageId: randomBytes(12).toString("hex"), timestamp: new Date().toISOString(), fromType: input.fromType, fromAgentId: input.fromAgent?.id || null, fromName: input.fromType === "user" ? "User" : input.fromAgent.name, destination, recipientAgentIds: recipients, kind, content: clean(input.content, "content", MAX_MESSAGE) };
	appendFileSync(messagesFile, `${JSON.stringify(item)}\n`, { encoding: "utf8", mode: 0o600 }); messages.push(item); return item;
}
function inbox(id, after) { const agent = agents[id], cutoffs = agent?.channelRevokedThrough || {}; return messages.filter((item) => item.id > after && item.fromAgentId !== id && item.recipientAgentIds.includes(id) && !(item.destination.type === "channel" && item.id <= Number(cutoffs[key(item.destination.name)] || 0))); }
const state = (agentId) => ({ version: VERSION, agents: activeAgents().map(publicAgent).sort((a, b) => a.name.localeCompare(b.name)), channels: publicChannels(agentId), messages: messages.slice(-250), totalMessages: messages.length, oldestLoadedId: messages.slice(-250)[0]?.id || null, latestMessageId: messages.at(-1)?.id || 0 });
function asset(response, name, type) { const path = join(extensionDir, name); return existsSync(path) ? text(response, 200, type, readFileSync(path)) : error(response, 404, "ASSET_NOT_FOUND", "Agent Mesh asset unavailable"); }

const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url || "/", origin), method = request.method || "GET";
		if (method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, version: VERSION, instance, pid: process.pid, host, port });
		if (method === "GET" && ["/auth", "/auth/help"].includes(url.pathname)) { if (!equal(url.searchParams.get("token") || "", token)) return error(response, 401, "AUTH_REQUIRED", "Valid dashboard token required"); const destination = url.pathname === "/auth/help" || url.searchParams.get("next") === "/help" ? "/help" : "/"; response.writeHead(302, headers({ Location: destination, "Set-Cookie": `mesh_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` })); return response.end(); }
		if (method === "GET" && url.pathname === "/" && !authenticated(request)) return text(response, 401, "text/html; charset=utf-8", readFileSync(join(extensionDir, "login.html")));
		if (method === "GET" && url.pathname === "/dashboard.css") return asset(response, "dashboard.css", "text/css; charset=utf-8");
		if (!authenticated(request)) return error(response, 401, "AUTH_REQUIRED", "Authentication is required");
		if (method === "GET" && url.pathname === "/") return asset(response, "dashboard.html", "text/html; charset=utf-8");
		if (method === "GET" && url.pathname === "/dashboard.js") return asset(response, "dashboard.js", "text/javascript; charset=utf-8");
		if (method === "GET" && url.pathname === "/help") return asset(response, "help.html", "text/html; charset=utf-8");
		if (method === "GET" && url.pathname === "/help.css") return asset(response, "help.css", "text/css; charset=utf-8");
		if (method === "GET" && url.pathname === "/help.js") return asset(response, "help.js", "text/javascript; charset=utf-8");
		if (method === "GET" && url.pathname === "/api/state") return json(response, 200, state(url.searchParams.get("agentId") || ""));
		if (method === "GET" && url.pathname === "/api/agents") return json(response, 200, { agents: activeAgents().map(publicAgent) });
		if (method === "GET" && url.pathname === "/api/channels") return json(response, 200, { channels: publicChannels(url.searchParams.get("agentId") || "") });
		if (method === "GET" && url.pathname === "/api/inbox") { const id = clean(url.searchParams.get("agentId"), "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (agents[id].removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin"); const after = Math.max(Number(url.searchParams.get("after")) || 0, Number(agents[id].lastAck || 0)); return json(response, 200, { messages: inbox(id, after).slice(0, 50), lastAck: agents[id].lastAck || 0 }); }
		if (method === "GET" && url.pathname === "/api/messages") { const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 250)), before = Number(url.searchParams.get("before")) || Infinity, after = Math.max(0, Number(url.searchParams.get("after")) || 0), channel = url.searchParams.get("channel"); const filtered = messages.filter((item) => item.id > after && item.id < before && (!channel || (item.destination.type === "channel" && key(item.destination.name) === key(String(channel).replace(/^#/, ""))))); return json(response, 200, { messages: before < Infinity ? filtered.slice(-limit) : filtered.slice(0, limit), totalMessages: messages.length }); }
		if (method === "GET" && url.pathname === "/api/export") return text(response, 200, "application/x-ndjson; charset=utf-8", existsSync(messagesFile) ? readFileSync(messagesFile) : Buffer.from(""), { "Content-Disposition": `attachment; filename="agent-mesh-${new Date().toISOString().slice(0, 10)}.jsonl"` });
		if (method !== "POST") return error(response, 404, "NOT_FOUND", "Route not found");
		mutationOrigin(request); const input = await body(request);
		if (url.pathname === "/api/register") { const id = clean(input.agentId, "agentId", 160), existing = agents[id]; if (existing?.removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin"); const name = existing?.name || cleanAgentName(input.requestedName); availableAgentName(name, id); agents[id] = { ...existing, id, name, cwd: clean(input.cwd, "cwd", 2000), sessionFile: clean(input.sessionFile || "", "sessionFile", 4000, true), model: clean(input.model || "", "model", 300, true), status: ["idle", "working"].includes(input.status) ? input.status : "idle", channels: existing?.channels || [DEFAULT_CHANNEL], generation: Number(existing?.generation || 1), registeredAt: existing?.registeredAt || new Date().toISOString(), lastSeenAt: Date.now(), lastAck: existing ? Number(existing.lastAck || 0) : Number(messages.at(-1)?.id || 0) }; persistAgents(); return json(response, 200, { agent: publicAgent(agents[id]) }); }
		if (url.pathname === "/api/agents/rejoin") { const id = clean(input.agentId, "agentId", 160), existing = agents[id]; if (!existing?.removedAt) return error(response, 409, "AGENT_NOT_REMOVED", "Agent is already registered"); existing.removedAt = undefined; existing.removedBy = undefined; existing.cwd = clean(input.cwd, "cwd", 2000); existing.sessionFile = clean(input.sessionFile || "", "sessionFile", 4000, true); existing.model = clean(input.model || "", "model", 300, true); existing.status = ["idle", "working"].includes(input.status) ? input.status : "idle"; existing.channels = []; existing.channelRevokedThrough = {}; existing.generation = Number(existing.generation || 1) + 1; existing.lastSeenAt = Date.now(); existing.lastAck = Number(messages.at(-1)?.id || 0); persistAgents(); return json(response, 200, { agent: publicAgent(existing) }); }
		if (url.pathname === "/api/heartbeat") { const id = clean(input.agentId, "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (agents[id].removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin"); agents[id].lastSeenAt = Date.now(); agents[id].status = ["idle", "working"].includes(input.status) ? input.status : "idle"; agents[id].model = clean(input.model || "", "model", 300, true); persistAgents(); return json(response, 200, { agent: publicAgent(agents[id]) }); }
		if (url.pathname === "/api/offline") { const id = clean(input.agentId, "agentId", 160); if (agents[id]) { agents[id].status = "offline"; agents[id].lastSeenAt = Date.now(); persistAgents(); } return json(response, 200, { ok: true }); }
		if (url.pathname === "/api/rename") { const id = clean(input.agentId, "agentId", 160), current = agents[id]; if (!current) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (current.removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin"); const rawName = String(input.name ?? ""), embeddedForce = /(?:^|\s)(?:--force|-f)(?=\s|$)/i.test(rawName), name = cleanAgentName(rawName.replace(/(?:^|\s)(?:--force|-f)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim()), force = input.force === true || embeddedForce, conflict = Object.values(agents).find((item) => item.id !== id && key(item.name) === key(name)); let displaced = null; if (conflict) { if (!force) return error(response, 409, "AGENT_NAME_TAKEN", `Agent name is already in use: ${name}`); displaced = publicAgent(conflict); let fallback; do fallback = `Disconnected-${randomBytes(6).toString("hex")}`; while (Object.values(agents).some((item) => item.id !== conflict.id && key(item.name) === key(fallback))); conflict.name = fallback; conflict.removedAt = new Date().toISOString(); conflict.removedBy = `force-rename:${id}`; conflict.channels = []; conflict.status = "offline"; conflict.lastAck = Number(messages.at(-1)?.id || 0); conflict.generation = Number(conflict.generation || 1) + 1; } current.name = name; current.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { agent: publicAgent(current), displaced }); }
		if (url.pathname === "/api/agents/remove") { const id = clean(input.agentId, "agentId", 160), removed = agents[id]; if (!removed || removed.removedAt) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); const result = publicAgent(removed); removed.removedAt = new Date().toISOString(); removed.removedBy = "dashboard"; removed.channels = []; removed.status = "offline"; removed.lastAck = Number(messages.at(-1)?.id || 0); removed.generation = Number(removed.generation || 1) + 1; persistAgents(); return json(response, 200, { removed: result, channels: publicChannels("") }); }
		if (url.pathname === "/api/channels/kick") { const id = clean(input.agentId, "agentId", 160), agent = agents[id]; if (!agent || agent.removedAt) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (!Array.isArray(input.channels) || !input.channels.length) return error(response, 400, "INVALID_CHANNELS", "At least one channel is required"); const requested = input.channels.map(cleanChannelName); for (const name of requested) { const channel = channelStore[key(name)]; if (!channel) return error(response, 404, "CHANNEL_NOT_FOUND", `Unknown channel: ${name}`); if (channel.closedAt) return error(response, 410, "CHANNEL_CLOSED", `Channel #${channel.name} is closed`); } const current = new Map(agent.channels.map((name) => [key(name), name])), changed = [], highWater = Number(messages.at(-1)?.id || 0); agent.channelRevokedThrough ||= {}; for (const name of requested) { const channel = channelStore[key(name)]; if (current.delete(key(channel.name))) changed.push(channel.name); agent.channelRevokedThrough[key(channel.name)] = highWater; } agent.channels = [...current.values()].sort((a, b) => a.localeCompare(b)); agent.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { agent: publicAgent(agent), channels: publicChannels(id), changed, revokedThrough: highWater }); }
		if (url.pathname === "/api/channels/close") { const requested = cleanChannelName(input.channel), channelKey = key(requested), channel = channelStore[channelKey]; if (!channel) return error(response, 404, "CHANNEL_NOT_FOUND", `Unknown channel: ${requested}`); if (channelKey === key(DEFAULT_CHANNEL)) return error(response, 409, "CHANNEL_PROTECTED", `#${DEFAULT_CHANNEL} cannot be closed`); if (channel.closedAt) return json(response, 200, { closed: channel, changed: false, revokedThrough: channel.closedThrough, channels: publicChannels("") }); const highWater = Number(messages.at(-1)?.id || 0); for (const agent of Object.values(agents)) { agent.channels = (agent.channels || []).filter((name) => key(name) !== channelKey); agent.channelRevokedThrough ||= {}; agent.channelRevokedThrough[channelKey] = Math.max(Number(agent.channelRevokedThrough[channelKey] || 0), highWater); } channel.closedAt = new Date().toISOString(); channel.closedBy = "dashboard"; channel.closedThrough = highWater; persistAgents(); persistChannels(); return json(response, 200, { closed: channel, changed: true, revokedThrough: highWater, channels: publicChannels("") }); }
		if (url.pathname === "/api/channels/join") return json(response, 200, updateMembership(clean(input.agentId, "agentId", 160), input.channels, "join"));
		if (url.pathname === "/api/channels/leave") return json(response, 200, updateMembership(clean(input.agentId, "agentId", 160), input.channels, "leave"));
		if (url.pathname === "/api/agent/messages") { const id = clean(input.agentId, "agentId", 160), fromAgent = agents[id]; if (!fromAgent) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); fromAgent.lastSeenAt = Date.now(); const item = appendMessage({ ...input, fromType: "agent", fromAgent }); persistAgents(); return json(response, 201, { message: item }); }
		if (url.pathname === "/api/user/messages") return json(response, 201, { message: appendMessage({ ...input, fromType: "user", fromAgent: null, kind: input.kind || "steer" }) });
		if (url.pathname === "/api/ack") { const id = clean(input.agentId, "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (agents[id].removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin"); agents[id].lastAck = Math.max(Number(agents[id].lastAck || 0), Number(input.messageId) || 0); agents[id].lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { lastAck: agents[id].lastAck }); }
		return error(response, 404, "NOT_FOUND", "Route not found");
	} catch (cause) { const status = Number(cause?.status) || 500; if (status >= 500) console.error(cause); return error(response, status, String(cause?.code || "INTERNAL_ERROR"), status >= 500 ? "Request failed" : cause.message); }
});
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, host, () => console.log(`Agent Mesh ${VERSION} listening on ${origin}`));
const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
