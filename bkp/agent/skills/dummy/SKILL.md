---
name: dummy
description: Analyze any software project and generate a fully standalone HTML explainer with a simple overview, detailed tabs, and an interactive relationship graph. Use when the user wants understandable project documentation or architecture maps.
---

# Dummy

Generate a beginner-friendly, fully standalone HTML document that explains the current project in plain English.

## Goal

Produce an HTML report that:
- is easy for a junior developer to understand
- opens on an **Overview** tab with a simple explanation of the project
- includes additional tabs for deeper detail
- includes an **interactive relationship graph** of the project
- has **inline CSS and JavaScript only**
- has **no external dependencies**
- supports **light and dark themes**, with **dark as default**
- uses a **VS Code-like dark color palette**

## Files in this skill

- `scripts/render-report.py` — turns a structured JSON analysis into a standalone HTML page
- `references/analysis-schema.md` — the JSON shape the renderer expects

## Workflow

1. Inspect the project.
   - Read key manifests and docs first (`package.json`, `README`, lockfiles, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.)
   - Identify languages, frameworks, entry points, main modules, data flow, and important directories
   - Build a simple mental model of how the project works

2. Create a structured analysis JSON file.
   - Save it in the project root as `project-report.data.json`
   - Follow `references/analysis-schema.md`
   - Keep the language simple and concrete
   - Prefer short sentences over jargon
   - Focus on helping a junior developer understand the project quickly
   - When the project uses a non-trivial architecture or pattern, explain it in plain English with examples

3. Render the final HTML.
   - Run:
     ```bash
     python3 ~/.pi/agent/skills/dummy/scripts/render-report.py project-report.data.json project-report.html
     ```
   - If the user asked for a different output path, use that instead

4. Validate the output.
   - Confirm the HTML file exists
   - Confirm it is standalone (no external CSS/JS/assets)
   - Confirm the default visible tab is **Overview**
   - Confirm the graph has nodes and edges when the project structure supports them

## Writing guidance

### The Overview tab must answer
- What is this project?
- What problem does it solve?
- What technology does it use?
- Where should a new developer start reading?
- What are the most important moving parts?

### Keep explanations simple
- Explain systems in plain language
- Avoid assuming deep framework knowledge
- If you mention a concept like “adapter”, “worker”, or “middleware”, explain what it means in this project
- If you detect a named pattern or architecture such as CQRS, event sourcing, DDD, hexagonal architecture, micro-frontends, message buses, sagas, or repositories, explain:
  - what it is in general
  - why teams use it
  - a simple example of how it works
  - how this specific project is using it
  - what files or modules a junior developer should inspect to see it in action

### Pattern explanation standard
When a pattern is important to understanding the project, do not just name it.
Add enough detail that a junior developer could read the report and come away understanding it.

For example, if the project uses CQRS, explain in simple terms:
- CQRS separates reads from writes
- commands change state, queries read state
- why that can help in some systems
- what the command side and query side appear to be in this project
- a concrete project-specific example flow

Prefer concrete examples like:
- “When a user submits X, module A handles the write, then module B serves the read model”
- “Folder Y contains command handlers, while folder Z contains query handlers”

### Relationship graph guidance
Create graph nodes for important project parts such as:
- apps
- services
- modules
- packages
- APIs
- databases
- workers
- UI sections

Create graph edges for relationships such as:
- imports
- calls
- owns
- reads
- writes
- serves
- depends on

Do not try to map every file in very large repos. Prefer a clear high-level graph over a noisy one.

## Suggested tab set

Use these sections where applicable:
- Overview
- Architecture
- Structure
- Modules
- Dependencies
- Flows
- Concepts
- Risks
- Glossary

You may omit empty sections in the JSON, but still ensure the report is coherent.

## Completion checklist

Before finishing, verify that you have:
- created `project-report.data.json` (unless the user asked not to keep intermediates)
- created the final standalone HTML report
- kept CSS and JS inline
- used the renderer from this skill
- made the Overview understandable to a junior developer
- explained important patterns and concepts in enough detail to teach them
- included an interactive graph

## Notes

- For large repos, summarize at the subsystem level rather than file-by-file
- Prefer correctness and clarity over completeness
- If the project structure is ambiguous, say so explicitly in the report
- If a graph relationship is inferred rather than proven, describe it conservatively
