# Dummy analysis JSON schema

Save the analysis as `project-report.data.json` and render it with `scripts/render-report.py`.

## Shape

```json
{
  "projectName": "string",
  "generatedAt": "ISO-8601 timestamp",
  "sourcePath": "/absolute/or/project/path",
  "summary": {
    "oneLiner": "short plain-English summary",
    "whatItDoes": "simple explanation",
    "whoItIsFor": "target users or developers",
    "howItWorks": "high-level explanation",
    "whereToStart": ["files or directories to read first"]
  },
  "stack": [
    { "name": "Next.js", "role": "web framework", "notes": "optional" }
  ],
  "entryPoints": [
    { "name": "Web app", "path": "src/main.ts", "reason": "starts the app" }
  ],
  "architecture": [
    {
      "title": "Frontend",
      "summary": "what this area does",
      "items": ["important point 1", "important point 2"]
    }
  ],
  "structure": [
    {
      "path": "src/components",
      "purpose": "what lives here",
      "highlights": ["important files or subfolders"]
    }
  ],
  "modules": [
    {
      "id": "ui",
      "name": "UI layer",
      "type": "frontend",
      "path": "src/ui",
      "summary": "what this module does",
      "details": ["important note 1", "important note 2"],
      "dependsOn": ["api", "shared"]
    }
  ],
  "dependencies": {
    "runtime": [
      { "name": "react", "why": "builds the UI" }
    ],
    "development": [
      { "name": "vite", "why": "local dev/build tooling" }
    ]
  },
  "flows": [
    {
      "name": "User request flow",
      "summary": "short overview",
      "steps": [
        "User clicks a button",
        "UI calls the API layer",
        "API layer fetches data",
        "UI renders the response"
      ]
    }
  ],
  "concepts": [
    {
      "name": "CQRS",
      "summary": "short plain-English summary",
      "whatItIs": "what this concept means in general",
      "whyItIsUsed": "why teams use it",
      "howItWorks": [
        "simple step 1",
        "simple step 2"
      ],
      "projectUsage": "how this project uses the concept",
      "projectExamples": [
        "concrete example from this codebase"
      ],
      "whereToLook": [
        "src/application/commands",
        "src/application/queries"
      ]
    }
  ],
  "risks": [
    {
      "title": "Large shared module",
      "severity": "medium",
      "details": "why it may be hard to change"
    }
  ],
  "glossary": [
    {
      "term": "Worker",
      "meaning": "background process used by this project"
    }
  ],
  "details": [
    {
      "title": "Anything else worth documenting",
      "content": ["bullet 1", "bullet 2"]
    }
  ],
  "graph": {
    "nodes": [
      {
        "id": "ui",
        "label": "UI layer",
        "group": "frontend",
        "description": "renders screens and handles user interaction",
        "path": "src/ui"
      }
    ],
    "edges": [
      {
        "source": "ui",
        "target": "api",
        "label": "calls"
      }
    ]
  }
}
```

## Requirements

- `projectName` and `summary.oneLiner` are required
- Keep summaries short and plain-English
- If the project uses important architectural patterns, include a `concepts` section
- Prefer 5-20 graph nodes, unless the project is truly tiny or very large
- Graph node ids must be unique
- Edge `source` and `target` must refer to existing node ids
- `dependsOn` should reference module ids when possible

## Authoring tips

- If you do not know something, omit it rather than inventing it
- Use subsystem-level modules for large projects
- Use file-level modules only for small projects
- Keep `whereToStart` very practical
- Make `flows.steps` understandable without framework-specific jargon
- In `concepts`, teach the reader, not just label the pattern
- For concepts like CQRS, DDD, event sourcing, hexagonal architecture, repositories, or message buses, include a simple general explanation plus a project-specific example
