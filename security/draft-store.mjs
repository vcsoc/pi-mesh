import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  fstatSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { compileMarkdown } from "./policy.mjs";
import { policyMarkdown } from "./policy-schema.mjs";
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, code: "SECURITY_DRAFT_ERROR" });
const hash = (text) => createHash("sha256").update(text).digest("hex");
const revisionPattern = /^[a-f0-9-]{36}$/;
const baseline = policyMarkdown({
  schemaVersion: 1,
  workspace: "read-only",
  egress: [],
});
function directory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    throw failure("Unsafe draft storage directory");
}
function read(path, limit) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit)
      throw failure("Invalid or oversized stored draft");
    const text = readFileSync(fd, "utf8");
    if (Buffer.byteLength(text) > limit)
      throw failure("Stored draft exceeds limit");
    return text;
  } finally {
    closeSync(fd);
  }
}
function atomic(path, text) {
  const temp = path + "." + randomUUID() + ".tmp";
  const fd = openSync(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}
export class PolicyDrafts {
  constructor(root) {
    this.root = root;
    directory(root);
  }
  scope(scope, scopes) {
    if (typeof scope !== "string" || !scopes.some((item) => item.id === scope))
      throw failure("Select a known policy scope");
    const dir = join(this.root, hash(scope));
    directory(dir);
    return dir;
  }
  head(dir) {
    try {
      const head = JSON.parse(read(join(dir, "HEAD.json"), 16384));
      if (
        !Array.isArray(head.history) ||
        head.history.length > 20 ||
        head.history.some((item) => !revisionPattern.test(item.revision))
      )
        throw failure("Invalid stored revision index");
      return head;
    } catch (error) {
      if (error.code === "ENOENT") return { history: [] };
      throw error;
    }
  }
  get(scope, scopes, viewedRevision = "") {
    const dir = this.scope(scope, scopes),
      head = this.head(dir);
    const selected = viewedRevision
      ? head.history.find((item) => item.revision === viewedRevision)
      : head.history.at(-1);
    if (viewedRevision && !selected)
      throw failure("Retained revision not found", 404);
    const markdown = selected
      ? read(join(dir, selected.revision + ".md"), 32768)
      : baseline;
    if (selected && hash(markdown) !== selected.documentHash)
      throw failure("Stored revision changed; inspect it before recovery");
    const compiled = compileMarkdown(markdown, { allowWorkspaceWrite: true }); // proposal, NEVER an execution grant
    return {
      scope,
      scopes,
      revision: head.history.at(-1)?.revision ?? null,
      viewedRevision: selected?.revision ?? null,
      history: head.history,
      markdown,
      ...compiled,
      enforcement: "not-integrated",
      canApply: false,
      draftOnly: true,
    };
  }
  validate(input, scopes) {
    this.scope(input?.scope, scopes);
    try {
      return {
        ...compileMarkdown(input.markdown, { allowWorkspaceWrite: true }),
        draftOnly: true,
        canApply: false,
        enforcement: "not-integrated",
      };
    } catch (error) {
      throw failure(error.message);
    }
  }
  save(input, scopes) {
    if (input?.confirm !== true)
      throw failure("Confirm saving a draft (not enforcement)");
    this.validate(input, scopes);
    const dir = this.scope(input.scope, scopes),
      lock = join(dir, ".save-lock");
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw failure("Draft storage is busy; reload before retrying", 409);
    }
    try {
      const current = this.get(input.scope, scopes);
      if (input.baseRevision !== current.revision)
        throw failure(
          "Draft changed in another editor. Export your work, reload and compare before saving.",
          409,
        );
      const revision = randomUUID(),
        record = {
          revision,
          at: new Date().toISOString(),
          documentHash: hash(input.markdown),
          digest: this.validate(input, scopes).digest,
        };
      atomic(join(dir, revision + ".md"), input.markdown);
      const history = [...current.history, record].slice(-20);
      atomic(join(dir, "HEAD.json"), JSON.stringify({ history }));
      for (const old of current.history.filter(
        (item) => !history.includes(item),
      )) {
        try {
          unlinkSync(join(dir, old.revision + ".md"));
        } catch {}
      }
      return this.get(input.scope, scopes);
    } finally {
      rmdirSync(lock);
    }
  }
}
