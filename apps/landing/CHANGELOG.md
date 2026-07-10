# @riftydev/landing

## Unreleased

- Hero terminal now reports Node v24, matching the runtime identity and the Node 24 parity gate.
- Favicon still invisible: the SVG comment carried CSS-var token names (`--deep`, `--ac`), and a
  literal `--` inside an XML comment is illegal — browsers parse SVG as strict XML and reject the
  whole document ("Double hyphen within comment"), so the asset served 200 `image/svg+xml` yet the
  tab rendered nothing. Rewrote the comment without `--`; the regression now parses comment bodies
  (`tests/integration/landing-static.test.ts`) so a malformed favicon can't ship green again.
- Browser-tab favicon: the page shipped no `<link rel="icon">` so the tab was iconless. Added
  `public/favicon.svg` (lime diamond on `--deep`, matching the on-page `logoMark` + tokens) and the
  head link; guarded by `tests/integration/landing-static.test.ts`.
- Layout fixes: the explorer canvas grows to the world height so the bottom row no longer clips;
  the graph auto-fits + centres on both axes (responsive, recentres on resize) so it never spills off
  one edge with empty space on the other; the legend is laid out one group per row (type / realm /
  edge); the footer drops the "pet project" tagline. Removed the now-unused zoom-button + legend
  divider styles.
- Explorer review fixes: Realms view is now interactive — lane cards hover/click to highlight
  node + neighbours and drive a Realms inspector (hover wins over pin); active realm lane highlights
  in realm color during scenario playback (ext→page); per-realm lane tint + bounded scroll viewport
  with remembered scroll position. `mountExplorer` returns a disposer (removes window listeners,
  clears scenario + remeasure timers) for re-mount safety. Honesty: terminal role says
  "host-provided ghost-text completions" (not "AI"); hero meta says "Chromium-first".
- Rebuilt `rifty.dev` as a hi-fi Vite + vanilla-TS page with an embedded interactive architecture
  explorer (drag/pan graph, 6 BFS-animated scenarios, Schema/Realms/Hybrid views). Lime accent
  + diamond mark hardcoded. Honest copy: preview buffered (M12), Chromium-first, CEIL gaps visible.
  Netlify build moved to the monorepo-root Vite build; headers/redirects shipped via `public/`.
- Review polish: hero primary CTA now opens the live playground (`play.rifty.dev`); the explorer
  drops wheel + −/+ zoom (it hijacked landing scroll — drag-to-pan and node-drag stay); the
  `service worker` node moved out of the runtimes row (no overlap); the inspector is hidden at rest
  and appears on hover/pin so it never covers the graph.
- More polish: the pinned inspector is now dismissable (click the pinned node again, or click empty
  canvas); the nav "Star" button is now a bare GitHub icon; the logo mark is the diamond glyph.
- Netlify CI now installs + runs the Vite build and deploys `apps/landing/dist` (`--no-build`); the
  landing smoke check targets the new page title. Integration test
  `tests/integration/landing-static.test.ts` updated for the Vite SPA shell + `public/_headers`.
- (prev) Added the static `rifty.dev` landing page and Netlify headers/redirects.
