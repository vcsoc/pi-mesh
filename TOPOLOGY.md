# Project aggregation and page workspace — Mesh 2.8.2

The dashboard has a collapsible left navigation, exactly one central page and an optional right topology panel. Kanban, memberships, messages, fleet, recorded usage, Explorer, interventions and opened channel/configuration pages retain their existing data/approval controls. Navigation is local browser history (`#kanban`, `#fleet`, etc.), not a new API or permission boundary. Returning to a page retains its unsent drafts; reloading a browser is not draft persistence.

## Workspace controls

- Bare **`/mesh`** opens the authenticated dashboard. `/mesh dashboard` remains an alias; `/mesh team` explicitly opens the native team composer. Neither dashboard command launches workers.
- The **right topology panel starts collapsed on every visit**, including browsers whose older preferences saved the Inspector open. Click its map icon to open it; its separator supports pointer and keyboard resizing.
- **Expand topology across workspace** spans the centre and right areas, keeping left navigation available. Restore returns to the split view. Selecting a navigation page exits full-map mode. Narrow screens show the page or map rather than overlapping them.
- Collapse the left sidebar to an icon rail; accessible page names/tooltips remain. Search finds pages/channels. Up/Down/Home/End navigate page buttons. Alt+T expands the map, Alt+M focuses the page, Alt+R restores the workspace layout. Form typing is not intercepted.

## Topology interactions

- **Double-click a parent** to show/hide descendants in place. Other projects remain. The selected branch stays framed while groups move to make room; a leaf double-click focuses it.
- **Expand all / Collapse all** change local folds. **Fit** frames the overview without changing folds. Manual pan/zoom releases automatic group framing until another group is focused/toggled.
- **Right-click** any node for type-specific actions. Projects offer branch controls, Kanban and project-only focus; channels offer conversations/membership and permitted close; agents offer messages, configuration, interventions and existing enable/disconnect controls. Shared-channel aggregation is not a real project and offers no project board.
- **Focus project … only** is in the project context menu; **All projects** returns. Merely opening a project board need not hide other projects.
- Focused parents use Left/Right Arrow to collapse/expand; Shift+F10 opens the menu, Up/Down/Home/End navigate it and Escape returns focus. Parent mouse selection is deferred briefly to distinguish double-clicks without moving the second target.

Folds are bounded browser-local preferences. Nested folds survive reopening ancestors. Search temporarily reveals matching ancestry; clearing search restores folds. Presentation never changes memberships, parent metadata, claims or approval authority.

## Visual and layout contract

**Compact project-centred clusters**, not one global outer orbit: a deterministic tangent-circle packing fills the actual viewport aspect. Within each island, visible members occupy radial rings around the project hub. Channel/real-parent ownership still defines folding, even when an intermediate channel is positioned beside the project instead of stretching a single-child chain. Aggregate hub area indicates descendant population, ± glyphs remain readable, and inactive agents keep their role colours rather than becoming indistinguishable grey dots. Small separate status dots preserve real working/idle/offline/disabled colour evidence. Neutral curved links and gold selected-branch outlines/routes follow the aggregation reference. No decorative/fabricated relationship links are added.

Each registration has **one node**. Real same-project parent lineage defines the ownership forest; otherwise a same-project active channel is its visual home, then the project. This is presentation, not evidence a channel spawned an agent. Other recorded relationships remain edges. Collapsing reroutes external links through visible ancestors and retains represented-link counts; internal links return on expansion. Aggregate routes scale with represented links.

Variable-size node footprints are collision-separated using a spatial hash, including intermediate tween frames. Packed island bounds remove conservative empty space; viewport aspect changes invalidate geometry, telemetry does not. Group framing includes node extents, resize and reduced motion. Sigma culls crowded labels; hover/focus supplies full details. Arbitrarily long names at every zoom cannot all be promised collision-free text. Very large fleets can still need folding/zoom; the narrow-pane regression is not a minimum-size guarantee for unlimited nodes.

One persistent **Sigma4/WebGL2** GPU renderer draws real points/curved edges; it is not a screenshot/SVG substitute. Controls/graph/camera/context are reused. WebGL2 failure retains an accessible list and menus. Assets are self-hosted and authenticated; no CDN or runtime build.

## Qualification

Unit tests cover real identities/relationships, cyclic metadata, nested folds, represented counts, deterministic/aspect-aware caches, variable footprints across multiple hash cells, coincident inputs and512-agent geometry. GPU suites cover actual curved pixels, parent toggles, collision-free animation/body targets, framing, persistent folds/search, keyboard/typed/protected menus,500-agent reuse and fallback. A dedicated21-project/33-agent632px-pane suite checks centre occupancy, useful node/glyph sizes, role/status separation, light/dark/full-map screenshots, one visible page, back/forward, retained drafts, collapsed defaults and mobile navigation. Existing real isolated broker/Kanban and recorded Usage tests retain CAS/auth/comments/late-response and cost-coverage boundaries. RPC verifies bare/whitespace/explicit dashboard commands with a stub OS opener and no model requests. Native team composition remains explicit and approval-gated.
