import {
  METHODS,
  parsePolicyMarkdown,
  policyMarkdown,
} from "./policy-schema.mjs";

const node = (tag, text, attrs = {}) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};
let sequence = 0;
const enhanced = new WeakSet();
const fold = (text) =>
  String(text)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
function autocomplete(input, items, choose, query = () => input.value) {
  const wrap = node("span", undefined, { class: "mw-autocomplete" }),
    list = node("div", undefined, {
      class: "mw-options",
      role: "listbox",
      id: `mw-options-${++sequence}`,
    });
  const hint = node("small", "", {
    class: "mw-search-status",
    "aria-live": "polite",
  });
  input.before(wrap);
  wrap.append(input, list, hint);
  list.hidden = true;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";
  let matches = [],
    active = -1;
  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const pick = (index) => {
    if (!matches[index]) return;
    choose(matches[index].value);
    close();
    hint.textContent = `Selected ${matches[index].label}`;
  };
  const render = () => {
    if (input.matches(":disabled")) return close();
    const terms = fold(query()).trim().split(/\s+/).filter(Boolean);
    const all = items().filter((item) =>
      terms.every((term) => fold(item.label + " " + item.value).includes(term)),
    );
    matches = all.slice(0, 60);
    active = -1;
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren();
    for (const [index, item] of matches.entries()) {
      const option = node("div", item.label, {
        role: "option",
        id: `${list.id}-${index}`,
        "aria-selected": "false",
      });
      option.onpointerdown = (event) => {
        event.preventDefault();
        pick(index);
      };
      list.append(option);
    }
    if (!matches.length)
      list.append(
        node(
          "p",
          "No matching suggestions. Exact target availability is not inferred.",
        ),
      );
    hint.textContent = `${all.length} matches${all.length > 60 ? " · showing first 60; keep typing" : ""}`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () =>
    setTimeout(() => {
      if (document.activeElement !== input) close();
    }, 120),
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) render();
      if (!matches.length) return;
      active =
        active < 0
          ? event.key === "ArrowDown"
            ? 0
            : matches.length - 1
          : (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
            matches.length;
      [...list.children].forEach((option, index) =>
        option.setAttribute("aria-selected", String(index === active)),
      );
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault();
      pick(active);
    }
  });
  return {
    refresh: () => {
      if (document.activeElement === input) render();
    },
    close,
  };
}
function enhanceSelect(select) {
  if (enhanced.has(select)) return;
  enhanced.add(select);
  const name =
    select.getAttribute("aria-label") ||
    select.labels?.[0]?.textContent.trim().slice(0, 80) ||
    select.id ||
    "options";
  const search = node("input", undefined, {
    type: "search",
    class: "mw-select-search",
    placeholder: "Type to search…",
    "aria-label": "Search " + name,
  });
  select.before(search);
  const ac = autocomplete(
    search,
    () =>
      [...select.options]
        .filter(
          (option) =>
            !option.disabled &&
            (option.value ||
              !/^(choose|select|loading)/i.test(option.textContent.trim())),
        )
        .map((option) => ({ value: option.value, label: option.textContent })),
    (value) => {
      if (select.matches(":disabled")) return;
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      search.value = "";
    },
  );
  const update = () => {
    search.disabled = select.matches(":disabled");
    ac.refresh();
  };
  new MutationObserver(update).observe(select, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  update();
}
function enhanceInputs() {
  for (const select of document.querySelectorAll(
    "select:not(#topology-layout):not(#kind)",
  ))
    enhanceSelect(select);
  for (const input of document.querySelectorAll("input[list]")) {
    if (enhanced.has(input)) continue;
    enhanced.add(input);
    const source = document.getElementById(input.getAttribute("list"));
    if (!source) continue;
    input.removeAttribute("list");
    const ac = autocomplete(
      input,
      () =>
        [...source.querySelectorAll("option")].map((option) => ({
          value: option.value,
          label: option.label || option.value,
        })),
      (value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
    );
    new MutationObserver(ac.refresh).observe(source, {
      subtree: true,
      childList: true,
    });
  }
}
const examples = {
  "api.openai.com": ["/v1/responses", "/v1/chat/completions", "/v1/models"],
  "api.anthropic.com": ["/v1/messages", "/v1/models"],
  "generativelanguage.googleapis.com": ["/v1beta/models"],
  "api.github.com": ["/user", "/repos"],
  "example.com": ["/"],
};
async function api(path, body) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(12000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.error?.message ||
          data.error ||
          `Request failed (${response.status})`,
      ),
      { status: response.status },
    );
  return data;
}

const trigger = node("button", "Security policies", {
  type: "button",
  id: "security-workbench-open",
  "aria-haspopup": "dialog",
});
(
  document.querySelector("#sections") ||
  document.querySelector(".top-actions") ||
  document.querySelector("header") ||
  document.body
).append(trigger);
const dialog = node("dialog", undefined, {
  id: "security-workbench",
  "aria-labelledby": "mw-title",
});
document.body.append(dialog);
// Static markup only. All imported/user/server content uses textContent/value.
dialog.innerHTML = `<div class="mw-heading"><div><h1 id="mw-title">Security policy management</h1><p>Structured forms · shared validation · versioned Markdown drafts</p></div><button type="button" id="mw-close" aria-label="Close security management">Close</button></div>
<p class="mw-warning" role="note"><strong>Not enforced by this extension.</strong> Runtime integration is incomplete. Saving or validating a draft does not sandbox an agent, alter the gateway, approve a run or establish compliance. Never put credentials in policies.</p>
<div class="mw-toolbar"><label>Policy scope<select id="mw-scope" aria-label="Policy scope"></select></label><label>Retained revision<select id="mw-history" aria-label="Retained revision"></select></label><button type="button" id="mw-reload">Reload saved draft</button></div>
<p id="mw-state" role="status" aria-live="polite">Loading…</p>
<div class="mw-columns"><form id="mw-form" novalidate><fieldset id="mw-fields"><legend>Proposed permissions</legend><label>Workspace access<select id="mw-workspace" aria-label="Workspace access"><option value="read-only">Read-only workspace</option><option value="read-write">Read-write workspace — requires independent execution approval</option></select></label>
<p class="mw-help">Fixed baseline: required Landlock, UID/GID 1000, no writable system paths, scratch /tmp and /state, no host fallback. These are proposed settings, not observed runtime status.</p>
<h2>Outbound HTTPS rules</h2><p class="mw-help">Deny all unless explicitly listed. Exact host, port 443, inspected REST, enforce mode, /usr/local/bin/node. Suggestions are examples, not approved destinations or provider availability.</p><div id="mw-rules"></div><button type="button" id="mw-add">Add network rule</button>
<p id="mw-errors" class="mw-error" role="alert"></p><div class="mw-toolbar"><button type="button" id="mw-validate">Validate on server</button><button type="submit" id="mw-save">Save draft revision</button><button type="button" disabled title="Runtime adapters and administrator activation are not implemented">Apply enforcement — unavailable</button></div></fieldset></form>
<aside><h2>Review &amp; transfer</h2><p class="mw-help">All selected methods apply to all listed paths in a rule. No wildcards, encoded paths, arbitrary binaries or TLS bypasses. Keep rules narrow.</p><label>Markdown editor<textarea id="mw-markdown" rows="12" spellcheck="false" aria-label="Policy Markdown"></textarea></label><div class="mw-toolbar"><button type="button" id="mw-import-text">Load Markdown into form</button><label class="mw-file">Import .md<input id="mw-import-file" type="file" accept=".md,text/markdown,text/plain"></label><button type="button" id="mw-export">Export form as Markdown</button></div><p class="mw-help">Load Markdown explicitly before saving. Import preserves prose; structured edits change only the machine-readable block. Saving stores a proposal; it never activates it.</p><details open><summary>Compiled OpenShell policy</summary><pre id="mw-preview"></pre></details><details><summary>Changes from loaded revision</summary><pre id="mw-diff"></pre></details></aside></div>`;
const $ = (id) => dialog.querySelector("#mw-" + id);
let loaded = false,
  busy = false,
  dirty = false,
  markdownPending = false,
  baseRevision = null,
  scope = "",
  viewedRevision = "",
  original = "",
  template = "",
  ticket = 0;
const rows = [];
const message = (text) => {
  $("state").textContent = text;
};
function permissions() {
  return {
    schemaVersion: 1,
    workspace: $("workspace").value,
    egress: rows.map((row) => ({
      host: row.host.value.trim(),
      methods: [...row.boxes]
        .filter((box) => box.checked)
        .map((box) => box.value),
      paths: row.paths.value
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean),
    })),
  };
}
function currentMarkdown() {
  return policyMarkdown(permissions(), template);
}
function validation() {
  let result;
  $("errors").textContent = "";
  for (const row of rows) {
    row.error.textContent = "";
    row.host.removeAttribute("aria-invalid");
    row.paths.removeAttribute("aria-invalid");
  }
  try {
    result = parsePolicyMarkdown(currentMarkdown(), {
      allowWorkspaceWrite: true,
    });
    $("preview").textContent = JSON.stringify(result.policy, null, 2);
  } catch (error) {
    $("errors").textContent = error.message;
    const row = rows[Number(error.message.match(/Rule (\d+)/)?.[1]) - 1];
    if (row) {
      row.error.textContent = error.message;
      row.host.setAttribute("aria-invalid", "true");
      row.paths.setAttribute("aria-invalid", "true");
    }
    $("preview").textContent =
      "Invalid proposal — correct the indicated fields.";
  }
  $("fields").disabled = busy || markdownPending;
  $("save").disabled = !loaded || busy || !result || markdownPending;
  $("validate").disabled = !loaded || busy || !result || markdownPending;
  $("export").disabled = busy || !result || markdownPending;
  $("add").disabled = !loaded || busy || rows.length >= 16;
  const text = currentMarkdown();
  $("diff").textContent =
    text === original
      ? "No structured changes."
      : `Loaded revision: ${baseRevision || "unsaved baseline"}\n--- Loaded document\n${original}\n+++ Proposed document\n${text}`;
  return result;
}
function changed() {
  dirty = true;
  ticket++;
  if (!markdownPending) $("markdown").value = currentMarkdown();
  validation();
  message(
    markdownPending
      ? "Markdown edits are not loaded. Load them into the form or reload before saving."
      : "Unsaved proposal. Review, validate and save; enforcement remains unavailable.",
  );
}
function row(entry = { host: "", methods: [], paths: [] }) {
  const group = node("fieldset", undefined, { class: "mw-rule" }),
    legend = node("legend", `Network rule ${rows.length + 1}`);
  const host = node("input", undefined, {
    type: "text",
    maxlength: "253",
    placeholder: "api.example.com",
    "aria-label": `Rule ${rows.length + 1} host`,
  });
  host.value = entry.host;
  const paths = node("textarea", undefined, {
    rows: "3",
    maxlength: "8192",
    placeholder: "/v1/responses",
    "aria-label": `Rule ${rows.length + 1} paths`,
  });
  paths.value = entry.paths.join("\n");
  const hostLabel = node("label", "Exact HTTPS hostname"),
    pathLabel = node("label", "Exact paths — one per line");
  hostLabel.append(host);
  pathLabel.append(paths);
  const methods = node("div", undefined, {
      class: "mw-methods",
      role: "group",
      "aria-label": "Allowed HTTP methods",
    }),
    boxes = [];
  for (const method of [
    ...entry.methods,
    ...METHODS.filter((method) => !entry.methods.includes(method)),
  ]) {
    const label = node("label", method),
      box = node("input", undefined, { type: "checkbox", value: method });
    box.checked = entry.methods.includes(method);
    label.prepend(box);
    boxes.push(box);
    methods.append(label);
  }
  const error = node("p", "", { class: "mw-error", role: "status" }),
    remove = node("button", "Remove rule", { type: "button" });
  const item = { group, host, paths, boxes, error };
  rows.push(item);
  group.append(legend, hostLabel, methods, pathLabel, error, remove);
  $("rules").append(group);
  autocomplete(
    host,
    () =>
      [
        ...new Set([
          ...Object.keys(examples),
          ...rows.map((row) => row.host.value).filter(Boolean),
        ]),
      ].map((value) => ({
        value,
        label: value + " · example / current draft",
      })),
    (value) => {
      host.value = value;
      changed();
    },
  );
  autocomplete(
    paths,
    () =>
      [
        ...new Set([
          ...(examples[host.value.trim()] || ["/"]),
          ...rows.flatMap((row) => row.paths.value.split("\n")).filter(Boolean),
        ]),
      ].map((value) => ({
        value,
        label: value + " · example / current draft",
      })),
    (value) => {
      const pos = paths.selectionStart,
        start = paths.value.lastIndexOf("\n", pos - 1) + 1,
        end = paths.value.indexOf("\n", pos);
      paths.setRangeText(
        value,
        start,
        end < 0 ? paths.value.length : end,
        "end",
      );
      changed();
    },
    () => {
      const pos = paths.selectionStart;
      return paths.value.slice(paths.value.lastIndexOf("\n", pos - 1) + 1, pos);
    },
  );
  group.addEventListener("input", changed);
  remove.onclick = () => {
    rows.splice(rows.indexOf(item), 1);
    group.remove();
    rows.forEach((item, i) => {
      item.group.querySelector("legend").textContent = `Network rule ${i + 1}`;
      item.host.setAttribute("aria-label", `Rule ${i + 1} host`);
      item.paths.setAttribute("aria-label", `Rule ${i + 1} paths`);
    });
    changed();
  };
}
function loadForm(text) {
  const { spec } = parsePolicyMarkdown(text, { allowWorkspaceWrite: true });
  template = text;
  rows.length = 0;
  $("rules").replaceChildren();
  $("workspace").value = spec.workspace;
  for (const entry of spec.egress) row(entry);
  $("markdown").value = text;
  markdownPending = false;
  validation();
}
function setBusy(value) {
  busy = value;
  $("fields").disabled = value;
  $("scope").disabled = value;
  $("history").disabled = value;
  for (const id of ["reload", "import-text", "import-file", "markdown"])
    $(id).disabled = value;
  validation();
}
async function load(wantedScope = scope, revision = "") {
  const id = ++ticket;
  setBusy(true);
  try {
    const result = await api(
      "/api/security/draft?scope=" +
        encodeURIComponent(wantedScope) +
        "&revision=" +
        encodeURIComponent(revision),
    );
    if (id !== ticket) return;
    loaded = true;
    scope = result.scope;
    viewedRevision = revision;
    baseRevision = result.revision;
    original = result.markdown;
    $("scope").replaceChildren(
      ...result.scopes.map((item) => new Option(item.label, item.id)),
    );
    $("scope").value = scope;
    $("history").replaceChildren(
      new Option("Latest saved draft", ""),
      ...[...result.history]
        .reverse()
        .map(
          (item) =>
            new Option(
              item.at + " · " + item.revision.slice(0, 8),
              item.revision,
            ),
        ),
    );
    $("history").value = revision;
    loadForm(result.markdown);
    dirty = false;
    message(
      `${revision ? "Historical proposal loaded for review" : "Draft loaded"} · ${result.viewedRevision || "unsaved baseline"} · NOT ENFORCED`,
    );
  } catch (error) {
    if (id === ticket) {
      loaded = false;
      message("Could not load draft: " + error.message);
    }
  } finally {
    if (id === ticket) setBusy(false);
  }
}
function discard() {
  return (
    !dirty ||
    confirm(
      "Discard unsaved policy edits? Export/copy them first if needed. This does not affect active enforcement.",
    )
  );
}
trigger.onclick = () => {
  dialog.showModal();
  void load();
};
$("close").onclick = () => {
  if (busy) return message("Wait for the current operation before closing.");
  if (discard()) {
    dirty = false;
    ticket++;
    dialog.close();
    trigger.focus();
  }
};
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  $("close").click();
});
$("scope").onchange = () => {
  const value = $("scope").value;
  if (discard()) void load(value);
  else $("scope").value = scope;
};
$("history").onchange = () => {
  if (discard()) void load(scope, $("history").value);
  else $("history").value = viewedRevision;
};
$("reload").onclick = () => {
  if (discard()) void load(scope);
};
$("workspace").onchange = changed;
$("add").onclick = () => {
  if (rows.length < 16 && !busy) {
    row();
    changed();
    rows.at(-1).host.focus();
  }
};
$("markdown").oninput = () => {
  markdownPending = true;
  changed();
};
$("import-text").onclick = () => {
  try {
    loadForm($("markdown").value);
    changed();
  } catch (error) {
    $("errors").textContent = error.message;
  }
};
$("import-file").onchange = async () => {
  const file = $("import-file").files[0];
  if (!file) return;
  const id = ticket;
  try {
    if (file.size > 32768) throw new Error("Markdown file exceeds 32 KiB");
    const text = await file.text();
    if (id !== ticket || !dialog.open) return;
    parsePolicyMarkdown(text, { allowWorkspaceWrite: true });
    if (
      dirty &&
      !confirm("Replace unsaved form edits with this Markdown proposal?")
    )
      return;
    loadForm(text);
    changed();
  } catch (error) {
    $("errors").textContent = error.message;
  } finally {
    $("import-file").value = "";
  }
};
$("export").onclick = () => {
  if (!validation() || markdownPending) return;
  const url = URL.createObjectURL(
    new Blob([currentMarkdown()], { type: "text/markdown;charset=utf-8" }),
  );
  const link = node("a", "", {
    href: url,
    download: "openshell-policy-draft.md",
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("validate").onclick = async () => {
  if (!validation() || markdownPending) return;
  setBusy(true);
  const id = ticket;
  try {
    const result = await api("/api/security/validate", {
      scope,
      markdown: currentMarkdown(),
    });
    if (id === ticket)
      message(
        `Server validation passed · compiled SHA256 ${result.digest} · DRAFT ONLY, NOT ENFORCED`,
      );
  } catch (error) {
    if (id === ticket) message("Validation failed: " + error.message);
  } finally {
    setBusy(false);
  }
};
$("form").onsubmit = async (event) => {
  event.preventDefault();
  if (!validation() || busy || markdownPending) return;
  if (
    !confirm(
      "Save a policy DRAFT revision? This stores a proposal only: it does NOT activate OpenShell, sandbox agents or authorize work.",
    )
  )
    return;
  setBusy(true);
  try {
    const result = await api("/api/security/draft", {
      scope,
      markdown: currentMarkdown(),
      baseRevision,
      confirm: true,
    });
    baseRevision = result.revision;
    viewedRevision = "";
    original = result.markdown;
    dirty = false;
    loadForm(result.markdown);
    $("history").replaceChildren(
      new Option("Latest saved draft", ""),
      ...[...result.history]
        .reverse()
        .map(
          (item) =>
            new Option(
              item.at + " · " + item.revision.slice(0, 8),
              item.revision,
            ),
        ),
    );
    message(
      `Draft saved · ${result.revision} · NOT ENFORCED. Last 20 revisions retained.`,
    );
  } catch (error) {
    message(
      error.status === 409
        ? error.message
        : "Save was not confirmed. Reload to inspect before retrying: " +
            error.message,
    );
  } finally {
    setBusy(false);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
enhanceInputs();
new MutationObserver(enhanceInputs).observe(document.body, {
  childList: true,
  subtree: true,
});
