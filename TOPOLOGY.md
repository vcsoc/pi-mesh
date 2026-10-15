# Expandable topology — Mesh 2.8.1

The map uses radial project islands with smaller channel and recorded agent-family groups, aggregate circles with plus/minus indicators, curved relationships and an amber outline for the focused branch. It is one persistent Sigma 4/WebGL2 renderer, not a screenshot or SVG replacement.

## Interactions

- **Double-click a parent** to show/hide its descendants in place. Other projects are not filtered away. The selected branch is framed automatically while islands move to make room. Double-click a leaf to focus it.
- **Expand all / Collapse all** control the entire overview. **Fit** returns to the overview without changing folds. Pan/zoom deliberately releases automatic framing until another group is focused or toggled.
- **Right-click** any node for its type's actions. Projects offer branch controls, their Kanban and a project-only view. Channels offer conversations/membership and, except for protected user channels, close-with-confirmation. Agents offer messages, configuration, user intervention and existing enable/disconnect controls. A shared-channel grouping is not a real project and has no project-board action.
- The old project-only drilldown remains in the project context menu (**Focus project … only**) and board project selector. **All projects** leaves that drilldown. Opening Kanban from a project menu does not have to hide the other islands.
- **Left/Right Arrow** collapse/expand a focused parent. **Shift+F10** or the context-menu key opens its menu; Up/Down/Home/End navigate and Escape returns focus to the opener. Keyboard Enter/Space retains single-node selection.
- Mouse single-selection of a parent is briefly deferred to distinguish a double-click, avoiding a conversation/sidebar resize between the two clicks moving the target beneath the pointer.

Folds are saved only in browser local storage (bounded, malformed/unwritable storage tolerated). Nested folds survive reopening an ancestor. Search temporarily reveals matching ancestry; clearing it restores the saved folds. This does not alter channels, parent metadata, memberships, task claims or execution authority.

## Layout and fidelity

Every registration has **one** node. Real same-project parent lineage defines agent families; otherwise its same-project active channel is its visual home, falling back to its project. Home grouping is presentation, not a claim that a channel/orchestrator spawned an agent. Other joined channels and recorded lineage remain real edges. A collapsed branch reroutes external edges through its nearest visible ancestor, retaining represented-link counts rather than silently losing memberships. Internal hidden links remain in the full model and return on expansion.

Sibling subtrees reserve radial disk space; single-child chains avoid exponential empty space. A deterministic spatial-hash separation pass reserves node/short-label footprints. The same separation projects intermediate tween frames, so layout motion does not pass node bodies through one another. Camera fitting accounts for both viewport dimensions and group bounds, including resize; manual navigation is respected. Crowded overview labels are culled by Sigma; hover/focus supplies full details. Arbitrarily long labels are not promised unlimited collision-free text at every zoom level.

Telemetry reuses cached layout, existing node controls and the GPU context. Live arrivals reflow a focused group without resetting its camera to the full map. Reduced-motion browsers use settled placement without tweening. WebGL2-unavailable browsers retain the accessible node list and menus.

## Qualification

`test/topology-aggregation.test.mjs` covers real identity/edge retention, nested folds, cross-branch summaries, cycles/missing parents, deterministic caches, coincident-point separation and 512-agent layouts. The actual GPU/browser suite checks curved pixels, project/channel/agent toggles, collision-free animation frames, group containment, persistent folds/search, reduced motion, resize, protected/type-specific and keyboard menus, 500-agent context reuse and fallback. The isolated broker/Kanban suite also retains project-scoped comments, CAS/auth boundaries and delayed-response isolation. Tests never launch production workers or paid inference.
