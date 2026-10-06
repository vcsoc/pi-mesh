import { text } from "./workflow.mjs";

// Deterministic proposal only: no inference, delegation or execution while composing.
// New drafts are bounded; the runtime also preserves explicitly approved legacy continuation.
export function teamWorkRequest(request) {
  const goal = text(request?.trim(), "team request", 12000);
  const contract = `User completion contract:\n${goal}\n\nStay within this request and approved permissions. No delegation, unrequested commit/push, or weakening acceptance criteria. Preserve unrelated changes. Surface ambiguity, destructive actions and external blockers rather than guessing. Report observable verification, not just implementation claims.`;
  const gate = {
    type: "json",
    required: ["verdict", "evidence", "blockers"],
    types: { verdict: "string", evidence: "array", blockers: "array" },
    equals: { verdict: "pass" },
  };
  const outcome =
    "\nReturn ONLY JSON with verdict (pass or blocked), evidence (array of checks and outcomes), and blockers (array). Never pass when requirements remain unverified.";
  return {
    action: "run",
    background: true,
    definition: {
      isolation: "worktree",
      context: "fresh",
      maxCost: 10,
      stages: [
        {
          tasks: [
            {
              id: "plan",
              profile: "scout",
              task: `${contract}\nInspect the project and propose a concrete implementation plan, boundaries and measurable acceptance checks. Do not edit.`,
            },
          ],
        },
        {
          tasks: [
            {
              id: "implement",
              profile: "developer",
              task: `${contract}\nImplement the preceding plan and run relevant checks.${outcome}`,
              acceptance: [structuredClone(gate)],
            },
          ],
        },
        {
          tasks: [
            {
              id: "verify",
              profile: "tester",
              task: `${contract}\nIndependently verify each requirement. Add and run appropriate tests, repair defects within scope and repeat checks. Distinguish live, mocked and unverified evidence.${outcome}`,
              acceptance: [structuredClone(gate)],
            },
          ],
        },
        {
          tasks: [
            {
              id: "review",
              profile: "reviewer",
              task: `${contract}\nRead-only final review of correctness, security, scope and actual verification evidence. Inspect files, not just previous claims.${outcome}`,
              acceptance: [structuredClone(gate)],
            },
          ],
        },
      ],
    },
  };
}
