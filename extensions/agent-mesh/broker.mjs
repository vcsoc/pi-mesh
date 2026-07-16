import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 20_000;
const ONLINE_MS = 20_000;
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

const messages = [];
if (existsSync(messagesFile)) for (const line of readFileSync(messagesFile, "utf8").split(/\r?\n/)) {
	if (!line.trim()) continue;
	try { const value = JSON.parse(line); if (Number.isInteger(value?.id)) messages.push(value); } catch { /* tolerate interrupted tail */ }
}
let nextId = messages.reduce((max, item) => Math.max(max, item.id), 0) + 1;
let agents = {};
if (existsSync(agentsFile)) try { agents = JSON.parse(readFileSync(agentsFile, "utf8")); } catch { agents = {}; }

const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };
const cookies = (header = "") => Object.fromEntries(header.split(";").map((part) => { const i = part.indexOf("="); return i < 0 ? ["", ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }).filter(([key]) => key));
const authenticated = (request) => {
	const auth = String(request.headers.authorization || "");
	return (auth.startsWith("Bearer ") && equal(auth.slice(7), token)) || equal(cookies(request.headers.cookie).mesh_session || "", token);
};
const headers = (extra = {}) => ({
	"Cache-Control": "no-store",
	"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
	"Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", ...extra,
});
const json = (response, status, body) => { response.writeHead(status, headers({ "Content-Type": "application/json; charset=utf-8" })); response.end(JSON.stringify(body)); };
const text = (response, status, type, body, extra = {}) => { response.writeHead(status, headers({ "Content-Type": type, ...extra })); response.end(body); };
const error = (response, status, code, message) => json(response, status, { error: { code, message } });

async function body(request) {
	if (String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase() !== "application/json") throw Object.assign(new Error("JSON body required"), { status: 415, code: "JSON_REQUIRED" });
	let size = 0; const chunks = [];
	for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413, code: "BODY_TOO_LARGE" }); chunks.push(chunk); }
	try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
	catch { throw Object.assign(new Error("Valid JSON object required"), { status: 400, code: "INVALID_JSON" }); }
}
function mutationOrigin(request) { if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error("Request origin is not allowed"), { status: 403, code: "ORIGIN_NOT_ALLOWED" }); }
function atomic(path, value) {
	const temp = `${path}.${process.pid}.tmp`, backup = `${path}.bak`;
	writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
	try { if (existsSync(backup)) rmSync(backup, { force: true }); if (existsSync(path)) renameSync(path, backup); renameSync(temp, path); if (existsSync(backup)) rmSync(backup, { force: true }); }
	catch (cause) { if (!existsSync(path) && existsSync(backup)) renameSync(backup, path); if (existsSync(temp)) rmSync(temp, { force: true }); throw cause; }
}
const persistAgents = () => atomic(agentsFile, agents);
function clean(value, field, max, empty = false) { const result = String(value ?? "").trim(); if ((!empty && !result) || result.length > max || result.includes("\0")) throw Object.assign(new Error(`${field} is invalid`), { status: 400, code: "INVALID_INPUT" }); return result; }
function cleanName(value) { const name = clean(value, "name", 48).replace(/\s+/g, " "); if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) throw Object.assign(new Error("Invalid agent name"), { status: 400, code: "INVALID_AGENT_NAME" }); return name; }
const key = (value) => String(value).trim().toLocaleLowerCase("en-US");
const findAgent = (value) => Object.values(agents).find((item) => item.id === value || key(item.name) === key(value));
function available(name, except) { if (Object.values(agents).some((item) => item.id !== except && key(item.name) === key(name))) throw Object.assign(new Error(`Agent name is already in use: ${name}`), { status: 409, code: "AGENT_NAME_TAKEN" }); }
const publicAgent = (item) => ({ id: item.id, name: item.name, cwd: item.cwd, sessionFile: item.sessionFile || null, model: item.model || null, status: Date.now() - Number(item.lastSeenAt || 0) <= ONLINE_MS && item.status !== "offline" ? item.status : "offline", lastSeenAt: item.lastSeenAt, registeredAt: item.registeredAt, lastAck: Number(item.lastAck || 0) });
function appendMessage(input) {
	const targetText = String(input.to ?? "*").trim();
	const broadcast = targetText === "*" || ["all", "broadcast"].includes(key(targetText));
	const target = broadcast ? null : findAgent(targetText);
	if (!broadcast && !target) throw Object.assign(new Error(`Unknown agent: ${targetText}`), { status: 404, code: "AGENT_NOT_FOUND" });
	const kind = ["message", "question", "plan", "task", "decision", "status", "steer"].includes(input.kind) ? input.kind : "message";
	const item = { id: nextId++, messageId: randomBytes(12).toString("hex"), threadId: clean(input.threadId || `thread-${Date.now().toString(36)}`, "threadId", 100), timestamp: new Date().toISOString(), fromType: input.fromType, fromAgentId: input.fromAgent?.id || null, fromName: input.fromType === "user" ? "User" : input.fromAgent.name, toAgentId: target?.id || null, toName: target?.name || "All agents", broadcast, kind, content: clean(input.content, "content", MAX_MESSAGE) };
	appendFileSync(messagesFile, `${JSON.stringify(item)}\n`, { encoding: "utf8", mode: 0o600 }); messages.push(item); return item;
}
const inbox = (id, after) => messages.filter((item) => item.id > after && item.fromAgentId !== id && (item.broadcast || item.toAgentId === id));
const state = () => ({ version: VERSION, agents: Object.values(agents).map(publicAgent).sort((a, b) => a.name.localeCompare(b.name)), messages: messages.slice(-250), totalMessages: messages.length, oldestLoadedId: messages.slice(-250)[0]?.id || null, latestMessageId: messages.at(-1)?.id || 0 });
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
		if (method === "GET" && url.pathname === "/api/state") return json(response, 200, state());
		if (method === "GET" && url.pathname === "/api/agents") return json(response, 200, { agents: Object.values(agents).map(publicAgent) });
		if (method === "GET" && url.pathname === "/api/inbox") { const id = clean(url.searchParams.get("agentId"), "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); const after = Math.max(Number(url.searchParams.get("after")) || 0, Number(agents[id].lastAck || 0)); return json(response, 200, { messages: inbox(id, after).slice(0, 50), lastAck: agents[id].lastAck || 0 }); }
		if (method === "GET" && url.pathname === "/api/messages") { const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 250)), before = Number(url.searchParams.get("before")) || Infinity, after = Math.max(0, Number(url.searchParams.get("after")) || 0); const filtered = messages.filter((item) => item.id > after && item.id < before); return json(response, 200, { messages: before < Infinity ? filtered.slice(-limit) : filtered.slice(0, limit), totalMessages: messages.length }); }
		if (method === "GET" && url.pathname === "/api/export") return text(response, 200, "application/x-ndjson; charset=utf-8", existsSync(messagesFile) ? readFileSync(messagesFile) : Buffer.from(""), { "Content-Disposition": `attachment; filename="agent-mesh-${new Date().toISOString().slice(0, 10)}.jsonl"` });
		if (method !== "POST") return error(response, 404, "NOT_FOUND", "Route not found");
		mutationOrigin(request); const input = await body(request);
		if (url.pathname === "/api/register") { const id = clean(input.agentId, "agentId", 160), existing = agents[id], name = existing?.name || cleanName(input.requestedName); available(name, id); agents[id] = { ...existing, id, name, cwd: clean(input.cwd, "cwd", 2000), sessionFile: clean(input.sessionFile || "", "sessionFile", 4000, true), model: clean(input.model || "", "model", 300, true), status: ["idle", "working"].includes(input.status) ? input.status : "idle", registeredAt: existing?.registeredAt || new Date().toISOString(), lastSeenAt: Date.now(), lastAck: existing ? Number(existing.lastAck || 0) : Number(messages.at(-1)?.id || 0) }; persistAgents(); return json(response, 200, { agent: publicAgent(agents[id]) }); }
		if (url.pathname === "/api/heartbeat") { const id = clean(input.agentId, "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); agents[id].lastSeenAt = Date.now(); agents[id].status = ["idle", "working"].includes(input.status) ? input.status : "idle"; agents[id].model = clean(input.model || "", "model", 300, true); persistAgents(); return json(response, 200, { agent: publicAgent(agents[id]) }); }
		if (url.pathname === "/api/offline") { const id = clean(input.agentId, "agentId", 160); if (agents[id]) { agents[id].status = "offline"; agents[id].lastSeenAt = Date.now(); persistAgents(); } return json(response, 200, { ok: true }); }
		if (url.pathname === "/api/rename") { const id = clean(input.agentId, "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); const name = cleanName(input.name); available(name, id); agents[id].name = name; agents[id].lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { agent: publicAgent(agents[id]) }); }
		if (url.pathname === "/api/agent/messages") { const id = clean(input.agentId, "agentId", 160), fromAgent = agents[id]; if (!fromAgent) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); fromAgent.lastSeenAt = Date.now(); const item = appendMessage({ ...input, fromType: "agent", fromAgent }); persistAgents(); return json(response, 201, { message: item }); }
		if (url.pathname === "/api/user/messages") return json(response, 201, { message: appendMessage({ ...input, fromType: "user", fromAgent: null, kind: input.kind || "steer" }) });
		if (url.pathname === "/api/ack") { const id = clean(input.agentId, "agentId", 160); if (!agents[id]) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); agents[id].lastAck = Math.max(Number(agents[id].lastAck || 0), Number(input.messageId) || 0); agents[id].lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { lastAck: agents[id].lastAck }); }
		return error(response, 404, "NOT_FOUND", "Route not found");
	} catch (cause) { const status = Number(cause?.status) || 500; if (status >= 500) console.error(cause); return error(response, status, String(cause?.code || "INTERNAL_ERROR"), status >= 500 ? "Request failed" : cause.message); }
});
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, host, () => console.log(`Agent Mesh ${VERSION} listening on ${origin}`));
const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
