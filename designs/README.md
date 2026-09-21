# Agent Mesh dashboard design studies

Open **index.html** in a browser to compare all seven concepts. No build, installation, broker, or authentication is required. Keep the HTML files beside `styles.css` and `app.js`.

Alternatively, from this repository:

```sh
python -m http.server 8080 --bind 127.0.0.1 --directory extensions/agent-mesh/designs
```

Then visit http://127.0.0.1:8080.

## Concepts

| # | Preview | Layout emphasis |
|---|---|---|
| 1 | `01-workbench.html` | Explorer + transcript + intervention inspector |
| 2 | `02-mission-control.html` | Overview metrics + activity + quick actions |
| 3 | `03-channel-desk.html` | Channel conversation + bottom composer + members |
| 4 | `04-topology.html` | Membership graph + selection inspector + transcript |
| 5 | `05-signal-board.html` | Working / idle / offline presence lanes |
| 6 | `06-fleet-admin.html` | Sidebar admin panel + searchable participant table |
| 7 | `07-policy-admin.html` | Sidebar admin panel + project policies + membership matrix |

Recommendation: **Workbench** as the everyday dashboard, with **Fleet Admin** as its administrative view. Channel Desk is the strongest alternative when readable conversations matter more than always-visible controls.

## Extension review informing these designs

Inspected `../README.md`, `../index.ts`, `../dashboard.html`, `../dashboard.js`, and broker API routes in `../broker.mjs`. This was a workflow/UI review, not a security audit.

- The existing dashboard already has the right primitives: channel selection, presence, a flat transcript, user interventions, memberships, project blocking, global and participant switches, and JSONL export.
- Its header and intervention sidebar mix reading controls with high-impact policy operations. The proposals separate daily coordination from administration, or provide stronger visual grouping.
- Existing kick, removal, project-block, and global-disable actions execute directly. The concepts demonstrate explicit scope and confirmation before high-impact operations.
- Channel/agent context menus should not be the only discovery path. Visible membership and channel-lifecycle controls make these operations easier to find.
- Joined channels are public routing groups, not private rooms. Agent-to-agent scope differs from dashboard administrator authority; the layouts retain this distinction.
- Removal, participant disablement, and project blocks have different consequences. Admin layouts expose those differences rather than treating them as one generic off switch.
- Presence is not task execution progress. Signal Board deliberately avoids invented completion percentages or scheduler controls.
- The topology is derived from sample memberships, not actual network links or traffic measurements. Only backend/testing and their agents are shown.
- No roles, accounts, billing, CPU charts, or unsupported telemetry are presented as existing mesh capabilities.

## Preview behavior

All data is fictional. There are **no fetch requests, credentials, broker calls, or persistent state changes**. Reload to reset.

- Gallery and design selector navigate between concepts.
- Channel buttons filter sample messages and set the composer destination.
- Channel interventions append safe, text-escaped sample messages locally. Direct/all interventions display local feedback only.
- Topology nodes update the inspector; Signal Board buttons target the composer.
- Fleet Admin supports search, presence filtering, no-results state, participant switches, and bulk-scope confirmation.
- Project buttons update their local preview state after confirmation. Global disable requires confirmation.
- Membership joins/kicks, agent removal, bulk removal, and channel closure are explanatory previews, not full simulated broker mutations. The membership matrix is read-only.
- `#general` cannot be closed in the preview.
- Export downloads a clearly marked sample JSONL file, not a complete live v2 transcript.
- Summary metrics are fixed design fixtures, not reactive analytics.

## Visual system

VS Code Dark+ inspired tokens: editor `#1e1e1e`, sidebar `#252526`, raised surfaces `#2d2d30`, border `#3e3e42`, text `#d4d4d4`, accent `#007acc`, button `#0e639c`, selection `#094771`, cyan `#9cdcfe`, green `#89d185`, purple `#c586c0`.

System fonts, responsive grids, native labeled form controls, visible keyboard focus, modal confirmations, live feedback, and text labels alongside status colors. Narrow screens stack panels; wide tables scroll within their containers.

## Verification

`node --check app.js` and `smoke-test.mjs` passed in Chromium. All eight pages (gallery plus seven designs) were checked at 1440px and 390px widths without document-level horizontal overflow or JavaScript errors. The smoke test also checks offline isolation, filtering, text-safe message insertion, empty states, confirmations, project/global toggles, protected channel handling, topology selection, agent addressing, and export.

The optional smoke test uses an existing Playwright installation; previews themselves have no dependencies:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node smoke-test.mjs
```

The production dashboard, styles, broker routes, and extension registration are unchanged. The broker does not serve these previews; open them directly or use the separate static server above.
