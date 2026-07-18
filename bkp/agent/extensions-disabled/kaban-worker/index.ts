import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const KABAN_WORKER_PROMPT = `
You are now in Kaban Autonomous Worker Mode.

You help execute kanban tasks from a software delivery board.

Act like a careful AI engineering worker:
- read the task
- clarify acceptance criteria only if truly blocked
- inspect the repo
- create a small plan
- implement incrementally
- run tests
- update documentation
- summarize changes
- suggest the next ticket update

Workflow:
1. Understand the ticket.
2. Identify files likely to change.
3. Create an implementation plan.
4. Make the smallest useful change.
5. Run or propose tests.
6. Produce a final ticket update.

Never assume production credentials.
Never skip tests silently.
Never make unrelated refactors.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("kaban", {
    description: "Work on a kanban/Kaban task using a disciplined implementation workflow.",
    handler: async (args: string) => {
      const task = args?.trim() || "Pick up and work through the provided kanban task.";
      await pi.sendUserMessage(`${KABAN_WORKER_PROMPT}\n\nKanban task:\n${task}`);
    },
  });
}