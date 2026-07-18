---
name: goal
description: Work autonomously across turns until a concrete success condition is verified. Use when the user wants continuous execution, self-checking, and proof that a completion contract has been satisfied.
---

# Goal

Use this skill when the user wants Pi to keep working until a condition is actually verified, not merely attempted.

## Purpose

`/goal` is for autonomous multi-turn execution under a contract.

The user provides a task plus a clear completion condition. You must continue iterating until the condition is verified with evidence, or until you are truly blocked and can explain exactly why.

## Expected input styles

Examples:

```text
/goal Fix the authentication controller bugs. Do not exit until npm run test:auth outputs 100% passing tests and zero console warnings.
/goal Split userController.ts into smaller modules. Success means all features compile and no file exceeds 200 lines.
/goal Implement docs/specs/stripe-webhooks.md. Success means all acceptance criteria are covered by tests and lint passes with zero warnings.
```

Optional token-budget style instructions may appear inline, for example:

```text
/goal "Implement the feature" --tokens 250k
```

Treat token budgets as execution constraints, not as success criteria.

## Operating contract

When running this skill:

1. Extract the success contract.
   - Identify the concrete stop condition.
   - Restate it in measurable terms.
   - Identify the evidence required to prove success.

2. Create a working loop.
   - inspect
   - plan
   - implement
   - run verification
   - interpret failures
   - iterate

3. Continue across turns until one of these is true:
   - the success condition is verified with proof
   - a hard blocker prevents progress and you can prove it
   - the user interrupts or changes the contract

4. Never stop just because one implementation pass is complete.
   Stop only when the contract is verified.

## Required behavior

- Prefer small, verifiable steps over risky rewrites.
- Re-run the exact verification commands implied by the contract.
- Show final proof, not just a claim.
- If you make assumptions, test them.
- If the contract mentions tests, lint, build, file sizes, warnings, outputs, or acceptance criteria, verify them directly.
- If the contract references a spec file, read it.
- If the task changes code, run relevant checks before declaring success.

## Self-evaluation loop

At the end of each major pass, explicitly ask:
- What part of the contract is still unverified?
- What evidence is missing?
- What is the next smallest step that reduces uncertainty?

If any part remains unverified, continue working.

## Verification-first stop rule

You are successful only when you can present concrete evidence such as:
- passing test output
- successful lint/build output
- file size measurements
- generated artifact existence
- acceptance criteria mapping
- diff or runtime proof

Do not treat “code written” as success.

## Recommended output pattern

When you begin:
- restate the goal contract
- list the verification steps
- start execution

When you finish:
- state that the goal is verified
- show the exact proof
- summarize changes made
- mention any residual risks that do not violate the contract

## Blocker handling

If blocked:
- identify the blocker precisely
- explain what evidence you gathered
- explain why the contract cannot currently be verified
- propose the smallest user action needed to unblock progress

## Honesty rules

- Do not pretend the contract is met if verification failed.
- Do not hide warnings or failed checks.
- Do not stop at “probably fixed.”
- Be rigorous and evidence-driven.
