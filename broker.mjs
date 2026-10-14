import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { PolicyDrafts } from './security/draft-store.mjs';
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listRuns, readRun, enqueueControl, controlReceipt } from './fleet-store.mjs';
import { runEvents } from './fleet.mjs';
import { canonicalRole, roleName, allocateName } from './naming.mjs';
import { UsageStore } from './usage.mjs';

const VERSION = "2.7.6";
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 20_000;
const MAX_CHANNEL = 64;
const ONLINE_MS = 20_000;
const THINKING_LEVELS = new Set(['off','minimal','low','medium','high','xhigh','max']);
const DEFAULT_CHANNEL = "user";
const reservedChannel = name => ["general", "user"].includes(String(name).toLowerCase());
function projectChannel(agent) {
 const existing=Object.values(channelStore).find(c=>c.projectHash===agent.projectHash&&!c.aliasFor&&!c.closedAt);if(existing)return existing.name;
 let base=migrateChannelName(agent.projectName||'project').slice(0,48);if(reservedChannel(base))base='project-'+base;
 const sameProject=channelStore[key(base)]?.projectHash===agent.projectHash;
 let name=base,n=1;while(Object.hasOwn(channelStore,key(name))){name=sameProject?`${base}-${n+1}`:`${base.slice(0,42)}-${agent.projectHash.slice(0,8)}${n>1?'-'+n:''}`;n++}
 const channel=ensureChannel(name,'project-default');channel.projectHash=agent.projectHash;return channel.name;
}
function canonicalChannel(value){const raw=String(value||'');return channelStore[raw.trim().toLocaleLowerCase('en-US')]?.aliasFor||raw;}
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
const policyFile = join(dataDir, "policy.json");

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
	return canonicalChannel(name);
}
function cleanProjectHash(value) {
	const hash = clean(value, "projectHash", 64).toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(hash)) throw Object.assign(new Error("projectHash must be a SHA-256 hex digest"), { status: 400, code: "INVALID_PROJECT_HASH" });
	return hash;
}
function projectIdentity(cwd) {
	const resolved = resolve(cwd), pathExists = existsSync(resolved), start = pathExists ? realpathSync(resolved) : resolved; let cursor = start, root = start;
	while (pathExists) { if (existsSync(join(cursor, ".git"))) { root = cursor; break; } const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; }
	const normalized = process.platform === "win32" ? root.toLocaleLowerCase("en-US") : root;
	return { projectHash: createHash("sha256").update(`agent-mesh-project\0${normalized}`).digest("hex"), projectName: basename(root) || "project" };
}
function migrateChannelName(value) {
	const normalized = String(value || "imported-general").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, MAX_CHANNEL);
	return normalized || "imported-general";
}
const key = (value) => String(value).trim().toLocaleLowerCase("en-US");

let agents = recoverObject(agentsFile);
let channelStore = Object.assign(Object.create(null),recoverObject(channelsFile));
let policy = recoverObject(policyFile);
policy = { enabled: policy.enabled !== false, blockedProjectHashes: [...new Set(Array.isArray(policy.blockedProjectHashes) ? policy.blockedProjectHashes.filter((value) => /^[a-f0-9]{64}$/.test(value)) : [])].sort(), blockedProjectNames: Object.fromEntries(Object.entries(policy.blockedProjectNames || {}).filter(([hash, name]) => /^[a-f0-9]{64}$/.test(hash) && typeof name === "string" && name.trim()).map(([hash, name]) => [hash, name.trim().slice(0, 160)])) };
function ensureChannel(value, createdBy = "system") {
	const requested = cleanChannelName(value || DEFAULT_CHANNEL), channelKey = key(requested), existing = channelStore[channelKey];
	if (existing) { if (existing.closedAt) throw Object.assign(new Error(`Channel #${existing.name} is closed`), { status: 410, code: "CHANNEL_CLOSED" }); return existing; }
	const channel = { name: requested, createdAt: new Date().toISOString(), createdBy };
	channelStore[channelKey] = channel;
	return channel;
}
ensureChannel(DEFAULT_CHANNEL);

for (const agent of Object.values(agents)) {
	const cwd=String(agent.cwd||'.');
 const project = !existsSync(resolve(cwd)) && /^[a-f0-9]{64}$/.test(agent.projectHash||'') ? {projectHash:agent.projectHash,projectName:agent.projectName||'project'} : projectIdentity(cwd); agent.projectHash = project.projectHash; agent.projectName = project.projectName;
	const legacy=`project-${String(agent.projectName||'project').replace(/[^\p{L}\p{N}._-]/gu,'-').slice(0,36)}-${agent.projectHash.slice(0,12)}`,old=channelStore[key(legacy)];
 if(old&&!old.closedAt&&!old.aliasFor){const target=channelStore[key(projectChannel(agent))];old.aliasFor=target.name;target.aliases=[...new Set([...(target.aliases||[]),old.name])]}
 const requested = (Array.isArray(agent.channels) ? agent.channels : ['general']).map(canonicalChannel);
 if(agent.activeChannel)agent.activeChannel=canonicalChannel(agent.activeChannel);
 if(agent.channelRevokedThrough)for(const [name,cutoff] of Object.entries(agent.channelRevokedThrough)){const renamed=key(canonicalChannel(name));agent.channelRevokedThrough[renamed]=Math.max(Number(agent.channelRevokedThrough[renamed]||0),Number(cutoff)||0)}
	const migrateDefault = requested.some(reservedChannel) || reservedChannel(agent.activeChannel);
	agent.channels = agent.removedAt ? [] : [...new Set([...requested.filter(name => !reservedChannel(name) && !channelStore[key(name)]?.closedAt), ...(migrateDefault ? [projectChannel(agent)] : [])].map(name => ensureChannel(name, 'migration').name))];
	if (migrateDefault && (!agent.activeChannel || reservedChannel(agent.activeChannel))) agent.activeChannel = projectChannel(agent);
	agent.enabled = agent.enabled !== false;
	if (policy.blockedProjectHashes.includes(agent.projectHash) && !policy.blockedProjectNames[agent.projectHash]) policy.blockedProjectNames[agent.projectHash] = agent.projectName;
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
// Preserve historical records but retire the ambiguous legacy shared channel.
if (channelStore.general) channelStore.general.closedAt ||= new Date().toISOString();
for (const agent of Object.values(agents)) agent.channels = (agent.channels || []).filter(name => !reservedChannel(name));
let nextId = messages.reduce((max, item) => Math.max(max, item.id), 0) + 1;
for (const agent of Object.values(agents)) {
 const previous = agent.activeChannel;
 repairActiveChannel(agent);
 // Legacy registrations start their new active-channel delivery scope at upgrade time.
 if (previous === undefined) agent.activeSinceId = nextId - 1;
}
atomic(channelsFile, channelStore);
atomic(policyFile, policy);
if (Object.keys(agents).length) atomic(agentsFile, agents);

const persistAgents = () => atomic(agentsFile, agents);
const persistChannels = () => atomic(channelsFile, channelStore);
const persistPolicy = () => atomic(policyFile, policy);
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
function activeChannel(agent) { return (agent?.channels || []).find(name => key(name) === key(agent?.activeChannel || "")) || null; }
function sharesChannel(left, right) { const channel = activeChannel(left); return Boolean(channel && !reservedChannel(channel) && key(channel) === key(activeChannel(right) || "")); }
function setActiveChannel(agent, name) {
 if (key(agent.activeChannel || "") !== key(name || "")) agent.activeSinceId = nextId - 1;
 agent.activeChannel = name || null;
}
function repairActiveChannel(agent) {
 setActiveChannel(agent, activeChannel(agent) || [...(agent.channels || [])].sort((a,b)=>a.localeCompare(b))[0] || null);
}
function projectBlocked(item) { return policy.blockedProjectHashes.includes(item.projectHash); }
function agentOperational(item) { return Boolean(item && !item.removedAt && policy.enabled && item.enabled !== false && !projectBlocked(item)); }
function policyError(item) {
	if (!policy.enabled) return Object.assign(new Error("Agent Mesh is disabled"), { status: 403, code: "MESH_DISABLED" });
	if (item?.enabled === false) return Object.assign(new Error("Agent is disabled"), { status: 403, code: "AGENT_DISABLED" });
	if (item && projectBlocked(item)) return Object.assign(new Error("Agent project is blocked"), { status: 403, code: "PROJECT_BLOCKED" });
	return null;
}
function requireOperationalAgent(id) {
	const agent = agents[id];
	if (!agent) throw Object.assign(new Error("Agent is not registered"), { status: 404, code: "AGENT_NOT_FOUND" });
	if (agent.removedAt) throw Object.assign(new Error("Agent was removed and must explicitly rejoin"), { status: 410, code: "AGENT_REMOVED" });
	const blocked = policyError(agent); if (blocked) throw blocked;
	return agent;
}
function findAgent(value) { return activeAgents().find((item) => item.id === value || key(item.name) === key(value)); }
function availableAgentName(name, except) { if (Object.values(agents).some((item) => item.id !== except && key(item.name) === key(name))) throw Object.assign(new Error(`Agent name is already in use: ${name}`), { status: 409, code: "AGENT_NAME_TAKEN" }); }
function modelCatalog(value){return Array.isArray(value)?value.slice(0,100).filter(row=>row&&typeof row.id==='string'&&row.id.length<=300&&/^[^\s/]+\/.+$/.test(row.id)).map(row=>({id:row.id,levels:Array.isArray(row.levels)?row.levels.filter(level=>THINKING_LEVELS.has(level)):[]})):[]}
function publicAgent(item) {
	const enabled = item.enabled !== false, blocked = projectBlocked(item);
	return { id: item.id, name: item.name, role: item.role || 'orchestrator', parentAgentId: item.parentAgentId || null, runId: item.runId || null, taskId: item.taskId || null, cwd: item.cwd, sessionFile: item.sessionFile || null, model: item.model || null, thinkingLevel: item.thinkingLevel || null, configurable: Boolean(item.configSupportedAt && Date.now()-item.configSupportedAt<=ONLINE_MS && !item.id.startsWith('job-') && !item.removedAt && item.status!=='offline' && policy.enabled && enabled && !blocked), configuration: item.pendingConfig ? {id:item.pendingConfig.id,state:item.pendingConfig.expiresAt>Date.now()?'pending':'expired',model:item.pendingConfig.model,thinkingLevel:item.pendingConfig.thinkingLevel} : item.configReceipt || null, status: Date.now() - Number(item.lastSeenAt || 0) <= ONLINE_MS && item.status !== "offline" ? item.status : "offline", activity: item.status === 'idle' ? (item.activity === 'waiting' ? 'waiting' : 'idle') : (item.activity || item.status), enabled, effectiveEnabled: policy.enabled && enabled && !blocked, projectHash: item.projectHash, projectName: item.projectName, projectBlocked: blocked, lastSeenAt: item.lastSeenAt, registeredAt: item.registeredAt, lastAck: Number(item.lastAck || 0), generation: Number(item.generation || 1), activeChannel: activeChannel(item), channels: [...(item.channels || [])].sort((a, b) => a.localeCompare(b)) };
}
function publicChannels(agentId) {
	const joinedKeys = new Set((agents[agentId]?.channels || []).map(key));
	return Object.values(channelStore).filter((channel) => !channel.closedAt && !channel.aliasFor).map((channel) => {
		const members = activeAgents().filter((agent) => key(channel.name) === DEFAULT_CHANNEL || (agent.channels || []).some((name) => key(name) === key(channel.name)));
		return { ...channel, userOnly: key(channel.name) === DEFAULT_CHANNEL, active: key(activeChannel(agents[agentId]) || "") === key(channel.name), joined: joinedKeys.has(key(channel.name)), memberIds: members.map((member) => member.id), memberNames: members.map((member) => member.name).sort((a, b) => a.localeCompare(b)), memberCount: members.length };
	}).sort((a, b) => a.name.localeCompare(b.name));
}
function updateMembership(agentId, names, action) {
	const agent = requireOperationalAgent(agentId);
	if (!Array.isArray(names) || names.length === 0) throw Object.assign(new Error("At least one channel is required"), { status: 400, code: "INVALID_CHANNELS" });
	const requestedNames = names.map(cleanChannelName);
	if (requestedNames.some(reservedChannel)) throw Object.assign(new Error('#user is a user-to-agent inbox, not a peer channel. Reply with agent_mesh_send to #user without switching channels.'), { status: 403, code: 'USER_CHANNEL_ONLY' });
	// Validate the whole batch before mutating or creating any memberships.
	if (action === "join") for (const name of requestedNames) if (channelStore[key(name)]?.closedAt) throw Object.assign(new Error(`Channel #${name} is closed`), { status: 410, code: "CHANNEL_CLOSED" });
	if (action === "leave") for (const requested of requestedNames) if (!channelStore[key(requested)]) throw Object.assign(new Error(`Unknown channel: ${requested}`), { status: 404, code: "CHANNEL_NOT_FOUND" });
	const current = new Map((agent.channels || []).map((name) => [key(name), name]));
	const changed = [];
	for (const requested of requestedNames) {
		if (action === "join") { const channel = ensureChannel(requested, agent.id); if (!current.has(key(channel.name))) { current.set(key(channel.name), channel.name); changed.push(channel.name); } }
		else { const channel = channelStore[key(requested)]; if (current.delete(key(channel.name))) changed.push(channel.name); }
	}
	agent.channels = [...current.values()].sort((a, b) => a.localeCompare(b));
	if (action === "join") setActiveChannel(agent, channelStore[key(requestedNames[0])].name);
	else {
	 agent.channelRevokedThrough ||= {};
	 for (const name of requestedNames) agent.channelRevokedThrough[key(name)] = nextId - 1;
	 repairActiveChannel(agent);
	}
	agent.lastSeenAt = Date.now();
	persistChannels(); persistAgents();
	return { agent: publicAgent(agent), channels: publicChannels(agentId), changed };
}
function appendMessage(input) {
	const targetText = clean(input.to ?? "*", "to", 160), userMessage = input.fromType === 'user', userReply = !userMessage && ['#user', '#general'].includes(key(targetText)), administrative = userMessage || userReply;
	const scopeAgent = administrative ? null : input.fromAgent || null;
	const scopeChannel = administrative ? DEFAULT_CHANNEL : scopeAgent ? activeChannel(scopeAgent) : null;
	if (scopeAgent && !scopeChannel) throw Object.assign(new Error("Select an active channel with /mesh join or /mesh switch first"), { status: 403, code: "NO_ACTIVE_CHANNEL" });
	let destination, recipients;
	if (userReply) {
		destination = { type: 'channel', id: DEFAULT_CHANNEL, name: DEFAULT_CHANNEL }; recipients = [];
	} else if (userMessage && Array.isArray(input.recipientAgentIds)) {
		if (!input.recipientAgentIds.length || input.recipientAgentIds.length > 200) throw Object.assign(new Error('Choose 1–200 recipients'), { status: 400, code: 'INVALID_RECIPIENTS' });
		recipients = input.recipientAgentIds.map(id => requireOperationalAgent(clean(id, 'agentId', 160)).id);
		destination = { type: 'channel', id: DEFAULT_CHANNEL, name: DEFAULT_CHANNEL };
	} else if (targetText.startsWith("#")) {
		const requested = cleanChannelName(targetText.slice(1)), channel = channelStore[userMessage && reservedChannel(requested) ? DEFAULT_CHANNEL : key(requested)];
		if (!channel) throw Object.assign(new Error(`Unknown channel: ${requested}`), { status: 404, code: "CHANNEL_NOT_FOUND" });
		if (channel.closedAt) throw Object.assign(new Error(`Channel #${channel.name} is closed`), { status: 410, code: "CHANNEL_CLOSED" });
		if (scopeAgent && !scopeAgent.channels.some((name) => key(name) === key(channel.name))) throw Object.assign(new Error(`Join #${channel.name} before sending to it`), { status: 403, code: "CHANNEL_MEMBERSHIP_REQUIRED" });
		if (scopeAgent && key(scopeChannel) !== key(channel.name)) throw Object.assign(new Error(`Switch to #${channel.name} before sending to it`), { status: 403, code: "ACTIVE_CHANNEL_REQUIRED" });
		destination = { type: "channel", id: channel.name, name: channel.name };
		recipients = activeAgents().filter((agent) => agentOperational(agent) && agent.id !== (scopeAgent?.id || input.scopeAgent?.id) && (key(channel.name) === DEFAULT_CHANNEL || agent.channels.some((name) => key(name) === key(channel.name))) && (!scopeAgent || sharesChannel(scopeAgent, agent))).map((agent) => agent.id);
	} else if (targetText === "*" || ["all", "broadcast"].includes(key(targetText))) {
		destination = { type: "all", id: null, name: "All agents" };
		recipients = activeAgents().filter((agent) => agentOperational(agent) && agent.id !== (scopeAgent?.id || input.scopeAgent?.id) && (!scopeAgent || sharesChannel(scopeAgent, agent))).map((agent) => agent.id);
	} else {
		const target = findAgent(targetText);
		if (!target) throw Object.assign(new Error(`Unknown agent: ${targetText}`), { status: 404, code: "AGENT_NOT_FOUND" });
		const blocked = policyError(target); if (blocked) throw blocked;
		if (scopeAgent && !sharesChannel(scopeAgent, target)) throw Object.assign(new Error("Agents must have the same active channel before they can communicate"), { status: 403, code: "NO_SHARED_CHANNEL" });
		destination = { type: "agent", id: target.id, name: target.name };
		recipients = [target.id];
	}
	recipients = [...new Set(recipients)].sort();
	if (!userReply && destination.type === "channel" && recipients.length === 0) throw Object.assign(new Error(`Channel #${destination.name} has no recipients`), { status: 409, code: "CHANNEL_HAS_NO_RECIPIENTS" });
	const kind = ["message", "question", "plan", "task", "decision", "status", "steer"].includes(input.kind) ? input.kind : "message";
	const item = { id: nextId++, messageId: randomBytes(12).toString("hex"), timestamp: new Date().toISOString(), fromType: input.fromType, administrative, fromAgentId: input.fromAgent?.id || null, scopeAgentId: input.fromType === "user" ? input.scopeAgent?.id || null : null, fromName: input.fromType === "user" ? "User" : input.fromAgent.name, scopeChannel, destination, recipientAgentIds: recipients, kind, content: clean(input.content, "content", MAX_MESSAGE) };
	appendFileSync(messagesFile, `${JSON.stringify(item)}\n`, { encoding: "utf8", mode: 0o600 }); messages.push(item); return item;
}
// Direct and broadcast destinations still belong to their immutable send-time channel.
function messageChannel(item) { const name=item.scopeChannel || (item.destination.type === 'channel' ? item.destination.name : null);return name?canonicalChannel(name):null; }
function messageInCurrentScope(item, recipient) {
	if (item.administrative) return item.fromType === 'user' && item.recipientAgentIds.includes(recipient.id);
	if (item.destination.type === "channel" && !recipient.channels.some((name) => key(name) === key(canonicalChannel(item.destination.name)))) return false;
	const scopeId = item.fromAgentId || item.scopeAgentId; if (!scopeId) return true;
	const scopeAgent = agents[scopeId];
	// Fail closed for old direct/all records without an immutable channel scope.
	const channel = messageChannel(item);
	return Boolean(channel && item.id > Number(recipient.activeSinceId || 0) && item.id > Number(scopeAgent?.activeSinceId || 0) && agentOperational(scopeAgent) && sharesChannel(scopeAgent, recipient) && key(channel) === key(activeChannel(recipient)));
}
function inbox(id, after) { const agent = agents[id], cutoffs = agent?.channelRevokedThrough || {}; return messages.filter((item) => item.id > after && item.fromAgentId !== id && item.recipientAgentIds.includes(id) && messageInCurrentScope(item, agent) && !(item.destination.type === "channel" && item.id <= Number(cutoffs[key(canonicalChannel(item.destination.name))] || 0))); }
function messagesForAgent(agent, items) {
	const channel = activeChannel(agent);
	return items.filter((item) => {
	 if (item.administrative) return item.fromAgentId === agent.id || (item.fromType === 'user' && item.recipientAgentIds.includes(agent.id));
	 if (item.destination.type === "channel") return Boolean(channel && key(channel) === key(canonicalChannel(item.destination.name)));
	 const own = item.fromAgentId === agent.id || item.scopeAgentId === agent.id || item.recipientAgentIds.includes(agent.id);
	 const administrative = !item.fromAgentId && !item.scopeAgentId;
	 return own && (administrative || Boolean(channel && item.scopeChannel && key(canonicalChannel(item.scopeChannel)) === key(channel)));
	});
}
function deactivateAgent(agent, removedBy) {
	const result = publicAgent(agent);
	agent.removedAt = new Date().toISOString(); agent.removedBy = removedBy; agent.channels = []; setActiveChannel(agent, null); agent.status = "offline"; agent.lastAck = Number(messages.at(-1)?.id || 0); agent.generation = Number(agent.generation || 1) + 1;
	return result;
}
function registrationName(input,existing,identity) {
 // Migrate only the recognizable historical generated default, never a supplied name.
 const legacyProject=basename(identity.cwd).replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^[^\p{L}\p{N}]+/u,'')||'Agent';
 const legacyName=`${legacyProject}-${String(input.agentId).replace(/\W/g,'').slice(-5)}`.slice(0,48);
 if(existing&&!existing.removedAt&&!existing.nameMode&&!input.requestedName&&existing.name===legacyName)existing={...existing,nameMode:'role',removedAt:'legacy-default-name'};
 const role=canonicalRole(existing?.role||input.role||'orchestrator');
 if(existing&&!existing.removedAt)return {name:existing.name,role,nameMode:existing.nameMode||'custom'};
 const requested=input.requestedName||(existing&&existing.nameMode!=='role'?(String(existing.removedBy||'').startsWith('offline-name-reclaimed:')?(existing.previousName||existing.name):existing.name):null);
 const explicit=Boolean(requested&&(!existing||existing.nameMode!=='role'));
 const base=explicit?cleanAgentName(requested):roleName(identity.projectName,role);
 const blocked=Boolean(policyError(identity));
 const choice=allocateName(agents,base,input.agentId,{explicit:explicit&&!existing&&!blocked,reclaimOffline:!blocked});
 if(choice.reclaim) {
  const previous=agents[choice.reclaim];previous.previousName=previous.name;
  deactivateAgent(previous,`offline-name-reclaimed:${input.agentId}`);
  let archive;do archive=`Archived-${randomBytes(6).toString('hex')}`;while(Object.values(agents).some(a=>key(a.name)===key(archive)));
  previous.name=archive;
 }
 return {name:choice.name,role,nameMode:explicit?'custom':'role'};
}
function registrationLineage(input, identity, existing) {
 const parentAgentId=input.parentAgentId||existing?.parentAgentId;
 if(!parentAgentId)return {};
 const parent=agents[clean(parentAgentId,'parentAgentId',160)],runId=clean(input.runId||existing?.runId,'runId',80),taskId=clean(input.taskId||existing?.taskId||'','taskId',160,true);
 if(!parent||parent.id===input.agentId||parent.projectHash!==identity.projectHash||!String(input.agentId).startsWith(`job-${runId}-`))throw Object.assign(new Error('Worker parent must be a different registered agent in the same project and match the job identity'),{status:409,code:'INVALID_WORKER_PARENT'});
 return {parentAgentId:parent.id,runId,taskId};
}
function registrationIdentity(input, existing) {
	const cwd = clean(input.cwd, "cwd", 2000), suppliedHash = cleanProjectHash(input.projectHash), project = projectIdentity(cwd);
	if (suppliedHash !== project.projectHash || (existing?.projectHash && existing.projectHash !== project.projectHash)) throw Object.assign(new Error("projectHash does not match the canonical project identity"), { status: 409, code: "PROJECT_IDENTITY_MISMATCH" });
	return { cwd, ...project, sessionFile: clean(input.sessionFile || "", "sessionFile", 4000, true), model: clean(input.model || "", "model", 300, true), status: ["idle", "working"].includes(input.status) ? input.status : "idle", enabled: existing?.enabled !== false };
}
const state = (agentId) => ({ version: VERSION, policy: { enabled: policy.enabled, blockedProjects: [...policy.blockedProjectHashes], blockedProjectNames: { ...policy.blockedProjectNames } }, agents: activeAgents().map(publicAgent).sort((a, b) => a.name.localeCompare(b.name)), channels: publicChannels(agentId), messages: messages.slice(-250), totalMessages: messages.length, oldestLoadedId: messages.slice(-250)[0]?.id || null, latestMessageId: messages.at(-1)?.id || 0 });
function asset(response, name, type) { const path = join(extensionDir, name); return existsSync(path) ? text(response, 200, type, readFileSync(path)) : error(response, 404, "ASSET_NOT_FOUND", "Agent Mesh asset unavailable"); }

const securityDrafts = new PolicyDrafts(join(dataDir, 'security-drafts'));
const securityScopes = () => [{id:'',label:'Mesh default — draft only'}, ...[...new Map(Object.values(agents).map(agent => [agent.projectHash, {id:agent.projectHash,label:`${agent.projectName} · ${agent.cwd}`}])).values()].filter(item => item.id)];
const subscribers = new Set();
const usageStore = new UsageStore();
const displayPresence = agent => {if(!agent)return '';const {lastSeenAt,lastAck,registeredAt,...display}=publicAgent(agent);return JSON.stringify(display)};
const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url || "/", origin), method = request.method || "GET";
		if (method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, version: VERSION, instance, pid: process.pid, host, port });
		if (method === "GET" && ["/auth", "/auth/help"].includes(url.pathname)) { if (!equal(url.searchParams.get("token") || "", token)) return error(response, 401, "AUTH_REQUIRED", "Valid dashboard token required"); const destination = url.pathname === "/auth/help" || url.searchParams.get("next") === "/help" ? "/help" : "/"; response.writeHead(302, headers({ Location: destination, "Set-Cookie": `mesh_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` })); return response.end(); }
		if (method === "GET" && url.pathname === "/" && !authenticated(request)) return text(response, 401, "text/html; charset=utf-8", readFileSync(join(extensionDir, "login.html")));
		if (method === "GET" && url.pathname === "/dashboard.css") return asset(response, "dashboard.css", "text/css; charset=utf-8");
		if (!authenticated(request)) return error(response, 401, "AUTH_REQUIRED", "Authentication is required");
		if (method === "GET" && url.pathname === "/") return asset(response, "dashboard.html", "text/html; charset=utf-8");
        if (method === 'GET' && url.pathname === '/api/security/draft') return json(response,200,securityDrafts.get(url.searchParams.get('scope') ?? '', securityScopes(), url.searchParams.get('revision') ?? ''));
        if (method === 'GET' && url.pathname === '/management-workbench.js') return asset(response,'management-workbench.js','text/javascript; charset=utf-8');
        if (method === 'GET' && url.pathname === '/management-workbench.css') return asset(response,'management-workbench.css','text/css; charset=utf-8');
        if (method === 'GET' && url.pathname === '/policy-schema.mjs') return asset(response,'security/policy-schema.mjs','text/javascript; charset=utf-8');
		if (method === "GET" && url.pathname === "/dashboard.js") return asset(response, "dashboard.js", "text/javascript; charset=utf-8");
        const topologyAssets={'/topology-layout.mjs':'topology-layout.mjs','/topology-model.mjs':'topology-model.mjs','/topology-structured.mjs':'topology-structured.mjs','/topology-renderer.mjs':'topology-renderer.mjs','/vendor/sigma-graphology.mjs':'vendor/sigma-graphology.mjs'};
        if (method === 'GET' && Object.hasOwn(topologyAssets,url.pathname)) return asset(response,topologyAssets[url.pathname],'text/javascript; charset=utf-8');
		if (method === 'GET' && url.pathname === '/fleet-panel.js') return asset(response,'fleet-panel.js','text/javascript; charset=utf-8');
		if (method === 'GET' && url.pathname === '/usage-panel.js') return asset(response,'usage-panel.js','text/javascript; charset=utf-8');
		if (method === 'GET' && url.pathname === '/orchestration') return asset(response,'ORCHESTRATION.md','text/plain; charset=utf-8');
		if (method === "GET" && url.pathname === "/help") return asset(response, "help.html", "text/html; charset=utf-8");
		if (method === "GET" && url.pathname === "/help.css") return asset(response, "help.css", "text/css; charset=utf-8");
		if (method === "GET" && url.pathname === "/help.js") return asset(response, "help.js", "text/javascript; charset=utf-8");
		if (method === 'GET' && url.pathname === '/api/events') {
			if (subscribers.size >= 32) return error(response, 429, 'TOO_MANY_STREAMS', 'Too many live dashboards');
			response.writeHead(200, headers({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })); response.write('data: ready\n\n'); subscribers.add(response);
			const timer = setInterval(() => response.write(': keepalive\n\n'), 15000); timer.unref();
			response.on('close', () => { clearInterval(timer); subscribers.delete(response); }); return;
		}
		if (method === 'GET' && url.pathname === '/api/fleet') return json(response, 200, { runs: listRuns(dataDir).slice(0,100) });
		if (method === 'GET' && url.pathname === '/api/fleet/run') return json(response, 200, { run: readRun(dataDir, url.searchParams.get('id')), events: runEvents(dataDir,url.searchParams.get('id')) });
		if (method === 'GET' && url.pathname === '/api/fleet/receipt') return json(response, 200, controlReceipt(dataDir,url.searchParams.get('id'),url.searchParams.get('receipt')));
		if (method === 'GET' && url.pathname === '/api/usage') return json(response, 200, await usageStore.query(Object.values(agents), Object.values(channelStore), url.searchParams));
		if (method === "GET" && url.pathname === "/api/state") return json(response, 200, state(url.searchParams.get("agentId") || ""));
		if (method === "GET" && url.pathname === "/api/agents") { const agentId = url.searchParams.get("agentId") || "", originAgent = agentId ? requireOperationalAgent(agentId) : null, visible = originAgent ? activeAgents().filter((agent) => agent.id !== originAgent.id && agentOperational(agent) && sharesChannel(originAgent, agent)) : activeAgents(); return json(response, 200, { agents: visible.map(publicAgent) }); }
		if (method === "GET" && url.pathname === "/api/agent") return json(response, 200, { agent: publicAgent(requireOperationalAgent(clean(url.searchParams.get("agentId"), "agentId", 160))) });
		if (method === 'GET' && url.pathname === '/api/agents/config') { const agent=requireOperationalAgent(clean(url.searchParams.get('agentId'),'agentId',160));return json(response,200,{request:agent.pendingConfig?.generation===agent.generation&&agent.pendingConfig.expiresAt>Date.now()?agent.pendingConfig:null,...(url.searchParams.get('catalog')==='1'?{models:agent.modelCatalog||[]}:{}),agent:publicAgent(agent)}); }
		if (method === "GET" && url.pathname === "/api/channels") { const agentId = url.searchParams.get("agentId") || ""; if (agentId) requireOperationalAgent(agentId); return json(response, 200, { channels: publicChannels(agentId) }); }
		if (method === "GET" && url.pathname === "/api/inbox") { const id = clean(url.searchParams.get("agentId"), "agentId", 160), agent = requireOperationalAgent(id), after = Math.max(Number(url.searchParams.get("after")) || 0, Number(agent.lastAck || 0)); return json(response, 200, { messages: inbox(id, after).slice(0, 50), lastAck: agent.lastAck || 0 }); }
		if (method === "GET" && url.pathname === "/api/messages") { const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 250)), before = Number(url.searchParams.get("before")) || Infinity, after = Math.max(0, Number(url.searchParams.get("after")) || 0), channel = url.searchParams.get("channel"), agentId = url.searchParams.get("agentId") || "", originAgent = agentId ? requireOperationalAgent(agentId) : null, visible = originAgent ? messagesForAgent(originAgent, messages) : messages, filtered = visible.filter((item) => item.id > after && item.id < before && (!channel || (messageChannel(item) && key(messageChannel(item)) === key(canonicalChannel(String(channel).replace(/^#/, "")))))); return json(response, 200, { messages: before < Infinity ? filtered.slice(-limit) : filtered.slice(0, limit), totalMessages: visible.length }); }
		if (method === "GET" && url.pathname === "/api/export") return text(response, 200, "application/x-ndjson; charset=utf-8", existsSync(messagesFile) ? readFileSync(messagesFile) : Buffer.from(""), { "Content-Disposition": `attachment; filename="agent-mesh-${new Date().toISOString().slice(0, 10)}.jsonl"` });
		if (method !== "POST") return error(response, 404, "NOT_FOUND", "Route not found");
		mutationOrigin(request); const input = await body(request);
        if (url.pathname === '/api/security/validate') return json(response,200,securityDrafts.validate(input,securityScopes()));
        if (url.pathname === '/api/security/draft') return json(response,200,securityDrafts.save(input,securityScopes()));
		const presenceOnly=['/api/heartbeat','/api/ack'].includes(url.pathname),presenceBefore=presenceOnly?displayPresence(agents[input.agentId]):null;
        response.once('finish', () => { if (response.statusCode < 400 && (!presenceOnly || presenceBefore!==displayPresence(agents[input.agentId]))) for (const stream of subscribers) { if (!stream.write('data: changed\n\n')) stream.destroy(); } });
		if (url.pathname === '/api/fleet/control') {
			try { return json(response, 202, enqueueControl(dataDir,input.id,input.action,input.message)); }
			catch (cause) { return error(response,400,'INVALID_FLEET_CONTROL',cause.message); }
		}
		if (url.pathname === "/api/policy/global") {
			if (typeof input.enabled !== "boolean") throw Object.assign(new Error("enabled must be boolean"), { status: 400, code: "INVALID_INPUT" });
			policy.enabled = input.enabled; persistPolicy();
			return json(response, 200, { policy: { enabled: policy.enabled, blockedProjects: [...policy.blockedProjectHashes], blockedProjectNames: { ...policy.blockedProjectNames } } });
		}
		if (url.pathname === '/api/agents/config') {
			const agent=requireOperationalAgent(clean(input.agentId,'agentId',160));
			if(!publicAgent(agent).configurable)return error(response,409,'AGENT_NOT_CONFIGURABLE','Reload the online Pi session; active child jobs use their approved immutable model');
			if(agent.pendingConfig&&agent.pendingConfig.expiresAt>Date.now())return error(response,409,'CONFIG_PENDING','A configuration request is already pending');
			const model=input.model===undefined?undefined:clean(input.model,'model',300),thinkingLevel=input.thinkingLevel;
			if(!model&&!thinkingLevel||model&&!/^[^\s/]+\/[^\s]+$/.test(model)||thinkingLevel!==undefined&&!THINKING_LEVELS.has(thinkingLevel))return error(response,400,'INVALID_CONFIG','Specify an exact provider/model ID and/or supported thinking level');
            if(input.generation!==undefined&&input.generation!==agent.generation)return error(response,409,'CONFIG_STALE','Agent generation changed; reload its catalog');
            const advertised=agent.modelCatalog?.find(item=>item.id===(model||agent.model));
            if(!advertised||thinkingLevel!==undefined&&!advertised.levels.includes(thinkingLevel))return error(response,400,'INVALID_CONFIG','Select an exact target-advertised model and supported thinking level');
			const pending={id:randomBytes(12).toString('hex'),model,thinkingLevel,generation:agent.generation,createdAt:Date.now(),expiresAt:Date.now()+600000};agent.pendingConfig=pending;persistAgents();return json(response,202,{request:pending});
		}
		if (url.pathname === '/api/agents/config/ack') {
			const agent=requireOperationalAgent(clean(input.agentId,'agentId',160)),pending=agent.pendingConfig;
			if(!pending||pending.id!==input.requestId||pending.generation!==agent.generation)return error(response,409,'CONFIG_STALE','Configuration request is no longer current');
			if(pending.expiresAt<=Date.now())return error(response,410,'CONFIG_EXPIRED','Configuration request expired before the agent applied it');
			if(!['applied','failed'].includes(input.state))return error(response,400,'INVALID_CONFIG','Configuration receipt must be applied or failed');
			if(input.state==='applied'){const actualModel=clean(input.model,'model',300),actualLevel=clean(input.thinkingLevel,'thinkingLevel',16);if(!THINKING_LEVELS.has(actualLevel))return error(response,400,'INVALID_CONFIG','Invalid applied thinking level');agent.model=actualModel;agent.thinkingLevel=actualLevel}
			agent.configReceipt={id:pending.id,state:input.state,model:pending.model,thinkingLevel:pending.thinkingLevel,actualModel:agent.model||null,actualThinkingLevel:agent.thinkingLevel||null,reason:input.state==='failed'?clean(input.reason,'reason',300):undefined,at:new Date().toISOString()};delete agent.pendingConfig;persistAgents();return json(response,200,{receipt:agent.configReceipt,agent:publicAgent(agent)});
		}
		if (url.pathname === '/api/agents/role') {
			const agent=requireOperationalAgent(clean(input.agentId,'agentId',160)),role=canonicalRole(input.role);
			const naming=registrationName({agentId:agent.id,role},{...agent,role,nameMode:'role',removedAt:'role-change'},agent);
			Object.assign(agent,naming);persistAgents();return json(response,200,{agent:publicAgent(agent)});
		}
		if (url.pathname === "/api/agents/toggle") {
			const id = clean(input.agentId, "agentId", 160), agent = agents[id];
			if (!agent) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered");
			if (typeof input.enabled !== "boolean") throw Object.assign(new Error("enabled must be boolean"), { status: 400, code: "INVALID_INPUT" });
			agent.enabled = input.enabled; persistAgents();
			return json(response, 200, { agent: publicAgent(agent) });
		}
		if (url.pathname === "/api/projects/toggle") {
			const projectHash = cleanProjectHash(input.projectHash);
			if (typeof input.blocked !== "boolean") throw Object.assign(new Error("blocked must be boolean"), { status: 400, code: "INVALID_INPUT" });
			const blocked = new Set(policy.blockedProjectHashes); if (input.blocked) { blocked.add(projectHash); const project = Object.values(agents).find((agent) => agent.projectHash === projectHash); if (project?.projectName) policy.blockedProjectNames[projectHash] = project.projectName; } else { blocked.delete(projectHash); delete policy.blockedProjectNames[projectHash]; } policy.blockedProjectHashes = [...blocked].sort(); persistPolicy();
			return json(response, 200, { projectHash, blocked: input.blocked, policy: { enabled: policy.enabled, blockedProjects: [...policy.blockedProjectHashes], blockedProjectNames: { ...policy.blockedProjectNames } } });
		}
		if (url.pathname === "/api/agents/kick-all") {
			const status = clean(input.status || "all", "status", 16);
			if (!["offline", "idle", "working", "online", "all"].includes(status)) throw Object.assign(new Error("Invalid kick status"), { status: 400, code: "INVALID_STATUS" });
			const selected = activeAgents().filter((agent) => { const current = publicAgent(agent).status; return status === "all" || (status === "online" ? current !== "offline" : current === status); });
			const removed = selected.map((agent) => deactivateAgent(agent, `dashboard:kick-all:${status}`)); persistAgents();
			return json(response, 200, { removed, count: removed.length, channels: publicChannels("") });
		}
		if (url.pathname === "/api/register") {
			const id = clean(input.agentId, "agentId", 160), existing = agents[id];
			if (existing?.removedAt) return error(response, 410, "AGENT_REMOVED", "Agent was removed and must explicitly rejoin");
			const identity=registrationIdentity(input,existing);
            const lineage=registrationLineage(input,identity,existing);
			const naming=registrationName(input,existing,identity);
			agents[id] = { ...existing, id, ...naming, ...identity, ...lineage, channels: existing?.channels || [ensureChannel(projectChannel(identity)).name], generation: Number(existing?.generation || 1), registeredAt: existing?.registeredAt || new Date().toISOString(), lastSeenAt: Date.now(), lastAck: existing ? Number(existing.lastAck || 0) : Number(messages.at(-1)?.id || 0), ...(input.configSupport===true?{configSupportedAt:Date.now(),thinkingLevel:THINKING_LEVELS.has(input.thinkingLevel)?input.thinkingLevel:null,modelCatalog:modelCatalog(input.modelCatalog)}:{}) };
			repairActiveChannel(agents[id]);
			persistChannels(); persistAgents(); const blocked = policyError(agents[id]); if (blocked) throw blocked;
			return json(response, 200, { agent: publicAgent(agents[id]) });
		}
		if (url.pathname === "/api/agents/rejoin") {
			const id = clean(input.agentId, "agentId", 160), existing = agents[id];
			if (!existing?.removedAt) return error(response, 409, "AGENT_NOT_REMOVED", "Agent is already registered");
			const identity = registrationIdentity(input, existing), blocked = policyError({ ...existing, ...identity }); if (blocked) throw blocked;
			Object.assign(existing, identity, registrationName(input,existing,identity), { removedAt: undefined, removedBy: undefined, channels: [], activeChannel: null, activeSinceId: nextId - 1, channelRevokedThrough: {}, generation: Number(existing.generation || 1) + 1, lastSeenAt: Date.now(), lastAck: Number(messages.at(-1)?.id || 0),pendingConfig:undefined,configSupportedAt:input.configSupport===true?Date.now():0,thinkingLevel:THINKING_LEVELS.has(input.thinkingLevel)?input.thinkingLevel:null,modelCatalog:input.configSupport===true?modelCatalog(input.modelCatalog):[] });
			persistAgents(); return json(response, 200, { agent: publicAgent(existing) });
		}
		if (url.pathname === "/api/heartbeat") { const id = clean(input.agentId, "agentId", 160), agent = requireOperationalAgent(id); agent.lastSeenAt = Date.now(); agent.status = ["idle", "working"].includes(input.status) ? input.status : "idle"; agent.activity = ['idle', 'working', 'thinking', 'waiting'].includes(input.activity) ? input.activity : agent.status; agent.model = clean(input.model || "", "model", 300, true);if(input.configSupport===true){agent.configSupportedAt=Date.now();agent.thinkingLevel=THINKING_LEVELS.has(input.thinkingLevel)?input.thinkingLevel:agent.thinkingLevel||null;if(input.modelCatalog)agent.modelCatalog=modelCatalog(input.modelCatalog)}persistAgents(); return json(response, 200, { agent: publicAgent(agent) }); }
		if (url.pathname === "/api/offline") { const id = clean(input.agentId, "agentId", 160), agent = requireOperationalAgent(id); agent.status = "offline"; agent.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { ok: true }); }
		if (url.pathname === "/api/rename") { const id = clean(input.agentId, "agentId", 160), current = requireOperationalAgent(id); const rawName = String(input.name ?? ""), embeddedForce = /(?:^|\s)(?:--force|-f)(?=\s|$)/i.test(rawName), name = cleanAgentName(rawName.replace(/(?:^|\s)(?:--force|-f)(?=\s|$)/gi, " ").replace(/\s+/g, " ").trim()), force = input.force === true || embeddedForce, conflict = Object.values(agents).find((item) => item.id !== id && key(item.name) === key(name)); let displaced = null; if (conflict) { if (!force) return error(response, 409, "AGENT_NAME_TAKEN", `Agent name is already in use: ${name}`); displaced = deactivateAgent(conflict, `force-rename:${id}`); let fallback; do fallback = `Disconnected-${randomBytes(6).toString("hex")}`; while (Object.values(agents).some((item) => item.id !== conflict.id && key(item.name) === key(fallback))); conflict.name = fallback; } current.name = name; current.nameMode = 'custom'; current.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { agent: publicAgent(current), displaced }); }
		if (url.pathname === "/api/agents/leave") { const id = clean(input.agentId, "agentId", 160), agent = agents[id]; if (!agent) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (agent.removedAt) return error(response, 410, "AGENT_REMOVED", "Agent already left the mesh"); const left = deactivateAgent(agent, `agent:${id}`); persistAgents(); return json(response, 200, { left, removed: left, channels: publicChannels("") }); }
		if (url.pathname === "/api/agents/remove") { const id = clean(input.agentId, "agentId", 160), agent = agents[id]; if (!agent || agent.removedAt) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); const removed = deactivateAgent(agent, "dashboard"); persistAgents(); return json(response, 200, { removed, channels: publicChannels("") }); }
		if (url.pathname === "/api/channels/kick") { const id = clean(input.agentId, "agentId", 160), agent = agents[id]; if (!agent || agent.removedAt) return error(response, 404, "AGENT_NOT_FOUND", "Agent is not registered"); if (!Array.isArray(input.channels) || !input.channels.length) return error(response, 400, "INVALID_CHANNELS", "At least one channel is required"); const requested = input.channels.map(cleanChannelName); for (const name of requested) { const channel = channelStore[key(name)]; if (!channel) return error(response, 404, "CHANNEL_NOT_FOUND", `Unknown channel: ${name}`); if (channel.closedAt) return error(response, 410, "CHANNEL_CLOSED", `Channel #${channel.name} is closed`); } const current = new Map(agent.channels.map((name) => [key(name), name])), changed = [], highWater = Number(messages.at(-1)?.id || 0); agent.channelRevokedThrough ||= {}; for (const name of requested) { const channel = channelStore[key(name)]; if (current.delete(key(channel.name))) changed.push(channel.name); agent.channelRevokedThrough[key(channel.name)] = highWater; } agent.channels = [...current.values()].sort((a, b) => a.localeCompare(b)); repairActiveChannel(agent); agent.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { agent: publicAgent(agent), channels: publicChannels(id), changed, revokedThrough: highWater }); }
		if (url.pathname === "/api/channels/close") { const requested = cleanChannelName(input.channel), channelKey = key(requested), channel = channelStore[channelKey]; if (!channel) return error(response, 404, "CHANNEL_NOT_FOUND", `Unknown channel: ${requested}`); if (channelKey === key(DEFAULT_CHANNEL)) return error(response, 409, "CHANNEL_PROTECTED", `#${DEFAULT_CHANNEL} cannot be closed`); if (channel.closedAt) return json(response, 200, { closed: channel, changed: false, revokedThrough: channel.closedThrough, channels: publicChannels("") }); const highWater = Number(messages.at(-1)?.id || 0); for (const agent of Object.values(agents)) { agent.channels = (agent.channels || []).filter((name) => key(name) !== channelKey); repairActiveChannel(agent); agent.channelRevokedThrough ||= {}; agent.channelRevokedThrough[channelKey] = Math.max(Number(agent.channelRevokedThrough[channelKey] || 0), highWater); } channel.closedAt = new Date().toISOString(); channel.closedBy = "dashboard"; channel.closedThrough = highWater; persistAgents(); persistChannels(); return json(response, 200, { closed: channel, changed: true, revokedThrough: highWater, channels: publicChannels("") }); }
		if (url.pathname === "/api/channels/switch") {
			const agentId = clean(input.agentId, "agentId", 160), requested = cleanChannelName(input.channel), channel = channelStore[key(requested)];
			requireOperationalAgent(agentId);
			if (!channel) return error(response, 404, "CHANNEL_NOT_FOUND", `Unknown channel: ${requested}`);
			if (channel.closedAt) return error(response, 410, "CHANNEL_CLOSED", `Channel #${channel.name} is closed`);
			return json(response, 200, updateMembership(agentId, [channel.name], "join"));
		}
		if (url.pathname === "/api/channels/join") return json(response, 200, updateMembership(clean(input.agentId, "agentId", 160), input.channels, "join"));
		if (url.pathname === "/api/channels/leave") return json(response, 200, updateMembership(clean(input.agentId, "agentId", 160), input.channels, "leave"));
		if (url.pathname === "/api/agent/messages") { const id = clean(input.agentId, "agentId", 160), fromAgent = requireOperationalAgent(id); fromAgent.lastSeenAt = Date.now(); const item = appendMessage({ ...input, fromType: "agent", fromAgent, scopeAgent: null }); persistAgents(); return json(response, 201, { message: item }); }
		if (url.pathname === "/api/user/messages") { const blocked = policyError(null); if (blocked) throw blocked; const originAgentId = String(input.originAgentId || ""), scopeAgent = originAgentId ? requireOperationalAgent(clean(originAgentId, "originAgentId", 160)) : null; return json(response, 201, { message: appendMessage({ ...input, fromType: "user", fromAgent: null, scopeAgent, kind: input.kind || "steer" }) }); }
		if (url.pathname === "/api/ack") { const id = clean(input.agentId, "agentId", 160), agent = requireOperationalAgent(id); agent.lastAck = Math.max(Number(agent.lastAck || 0), Number(input.messageId) || 0); agent.lastSeenAt = Date.now(); persistAgents(); return json(response, 200, { lastAck: agent.lastAck }); }
		return error(response, 404, "NOT_FOUND", "Route not found");
	} catch (cause) { const status = Number(cause?.status) || 500; if (status >= 500) console.error(cause); return error(response, status, String(cause?.code || "INTERNAL_ERROR"), status >= 500 ? "Request failed" : cause.message); }
});
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, host, () => console.log(`Agent Mesh ${VERSION} listening on ${origin}`));
const shutdown = () => { for (const stream of subscribers) stream.end(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
