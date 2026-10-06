import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parsePolicyMarkdown } from "./policy-schema.mjs";

export function compileMarkdown(text, options = {}) {
  const { policy } = parsePolicyMarkdown(text, options);
  return {
    schemaVersion: 1,
    policy,
    digest: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [path, grant, ...rest] = process.argv.slice(2);
    if (!path || rest.length || (grant && grant !== "--allow-workspace-write"))
      throw new Error(
        "usage: node policy.mjs FILE.md [--allow-workspace-write]",
      );
    const result = compileMarkdown(readFileSync(path, "utf8"), {
      allowWorkspaceWrite: grant === "--allow-workspace-write",
    });
    process.stdout.write(JSON.stringify(result.policy, null, 2) + "\n");
    process.stderr.write(
      `Compiled policy SHA256 (not OpenShell revision hash): ${result.digest}\n`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
