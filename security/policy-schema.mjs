// Shared browser/server schema. Suggestions and draft validation are NOT grants.
export const METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];
const fail = (message) => {
  throw new Error(`OpenShell policy rejected: ${message}`);
};
const object = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(`${label} has missing or unknown fields`);
};
function strictJSON(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("invalid JSON");
  }
  const tokens = [...text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)].map(
    (match) => match[0],
  );
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const key = JSON.parse(token),
        keys = stack.at(-1);
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        keys?.has(key)
      )
        fail("duplicate or reserved key");
      keys?.add(key);
    }
  }
  return value;
}
export function policyMarkdown(spec, previous = "") {
  const block =
    "```json openshell-policy-v1\n" + JSON.stringify(spec, null, 2) + "\n```";
  return previous
    ? previous.replace(
        /^```json openshell-policy-v1\r?\n[\s\S]*?^```[ \t]*$/m,
        () => block,
      )
    : "# OpenShell policy proposal\n\nDraft only; not active enforcement. Do not include credentials.\n\n" +
        block +
        "\n";
}
export function parsePolicyMarkdown(
  text,
  { allowWorkspaceWrite = false } = {},
) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).byteLength > 32768 ||
    text.includes("\0")
  )
    fail("invalid or oversized document");
  const fences = [
    ...text.matchAll(/^```([^\r\n]*)\r?\n([\s\S]*?)^```[ \t]*$/gm),
  ];
  if (
    [...text.matchAll(/^```/gm)].length !== 2 ||
    fences.length !== 1 ||
    fences[0][1] !== "json openshell-policy-v1"
  )
    fail("exactly one json openshell-policy-v1 block required");
  const spec = strictJSON(fences[0][2]);
  object(spec, ["schemaVersion", "workspace", "egress"], "document");
  if (spec.schemaVersion !== 1) fail("unsupported schema");
  if (!["read-only", "read-write"].includes(spec.workspace))
    fail("invalid workspace access");
  if (spec.workspace === "read-write" && allowWorkspaceWrite !== true)
    fail("writing requires an independent caller grant");
  if (!Array.isArray(spec.egress) || spec.egress.length > 16)
    fail("egress must be a list of at most 16 rules");
  const hosts = new Set(),
    network_policies = {};
  for (const [index, entry] of spec.egress.entries()) {
    const label = `Rule ${index + 1}: `;
    object(entry, ["host", "methods", "paths"], label + "egress rule");
    const host = entry.host;
    if (
      typeof host !== "string" ||
      host.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|internal|local|test|invalid)$/.test(host)
    )
      fail(label + "exact public DNS hostname required");
    if (hosts.has(host)) fail(label + "duplicate host");
    hosts.add(host);
    if (
      !Array.isArray(entry.methods) ||
      !entry.methods.length ||
      entry.methods.length > 7 ||
      entry.methods.some((method) => !METHODS.includes(method)) ||
      new Set(entry.methods).size !== entry.methods.length
    )
      fail(label + "explicit unique REST methods required");
    if (
      !Array.isArray(entry.paths) ||
      !entry.paths.length ||
      entry.paths.length > 16 ||
      entry.paths.some(
        (path) =>
          typeof path !== "string" ||
          path.length > 512 ||
          !/^\/[a-zA-Z0-9_./:-]*$/.test(path) ||
          path.split("/").some((part) => part === "." || part === ".."),
      ) ||
      new Set(entry.paths).size !== entry.paths.length
    )
      fail(
        label +
          "explicit unique absolute REST paths required (no globs/encoding/traversal)",
      );
    network_policies[`approved_${index}`] = {
      binaries: [{ path: "/usr/local/bin/node" }],
      endpoints: [
        {
          host,
          port: 443,
          protocol: "rest",
          enforcement: "enforce",
          rules: entry.methods.flatMap((method) =>
            entry.paths.map((path) => ({ allow: { method, path } })),
          ),
        },
      ],
    };
  }
  return {
    spec,
    policy: {
      version: 1,
      filesystem_policy: {
        include_workdir: false,
        read_only: [
          "/usr",
          "/lib",
          "/bin",
          "/sbin",
          "/etc",
          ...(spec.workspace === "read-only" ? ["/workspace"] : []),
        ],
        read_write: [
          "/tmp",
          "/state",
          ...(spec.workspace === "read-write" ? ["/workspace"] : []),
        ],
      },
      landlock: { compatibility: "hard_requirement" },
      process: { run_as_user: "1000", run_as_group: "1000" },
      network_policies,
    },
  };
}
