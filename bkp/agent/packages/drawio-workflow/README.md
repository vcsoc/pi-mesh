# drawio-workflow

Pi-specific draw.io skill package adapted from:
- https://github.com/Agents365-ai/drawio-skill

Provides:
- the `drawio` skill
- the `/drawio` command wrapper

## What it is for

Use this package when you want Pi to:
- generate editable `.drawio` files
- export PNG/SVG/PDF/JPG with the draw.io desktop CLI
- create architecture diagrams, ERDs, UML, sequence diagrams, flowcharts, and code structure diagrams
- use bundled helpers for shape search, codebase import graphs, autolayout, validation, PNG repair, and browser fallback URLs

## Examples

```text
/drawio Create a microservices architecture for this repo.
/drawio Draw an ERD for the current backend models and export PNG + SVG.
/drawio Visualize the module structure of this JS/TS project.
/skill:drawio Create a sequence diagram for the auth login flow.
```

## Notes

- Requires draw.io desktop CLI for local export.
- Optional Graphviz improves autolayout for large code structure diagrams.
- The skill content, scripts, references, and data were adapted from the upstream open-source project.
