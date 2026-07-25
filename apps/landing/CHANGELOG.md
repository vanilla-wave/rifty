# @riftydev/landing

## Unreleased

- Explorer now separates the raw WASI runner from npm esbuild: the proven
  esbuild JS adapter stays visible while its CLI/bin is an explicit loud gap.
- SEO/share hardening: compact title + description, WebSite JSON-LD, robots/sitemap, complete
  Open Graph/Twitter card with a branded 1200×630 PNG, Apple touch icon, and an indexable static
  shell that remains useful when client JS fails. Manual Netlify PR aliases now emit
  `X-Robots-Tag: noindex, nofollow`; production smoke guards against leaking that header.
- Faster first load: self-hosted Inter/Roboto Mono remove the render-blocking Google origin; the
  below-fold explorer is a reserved, near-viewport dynamic chunk; the Chromium-only build drops the
  modulepreload polyfill. Same-profile mobile Lighthouse: performance 85→100, FCP 3.1→1.5 s,
  LCP 3.1→1.5 s, initial DOM 921→363, third-party bytes 83.31→0 kB; initial JS gzip
  17.83→8.08 kB.
- UX/accessibility repair: semantic main/footer/h3 + skip link, WCAG-AA muted text, reduced-motion
  terminal, truthful structural-scenario wording, keyboard-operable graph nodes, drag no longer
  pins a node, clipboard errors recover, and all mobile navigation exits close the drawer.
- Review polish: the animated hero terminal reserves its final row viewport instead of shifting the
  whole hero as lines appear; restored `How it works` → architecture as the secondary CTA; balanced
  preset-card footer spacing around an explicit divider. `Run something real` now opens the
  configured playground directly instead of scrolling to the preset cards.
- Repositioned the landing around Rifty's real wedge: open, MIT, self-hostable browser runtime
  infrastructure. Hero code now uses only the public `Sandbox` API (`runtime.eval`, `fs`, events),
  and four "Run something real" cards deep-link into proven Vite 7, Express + SQLite, CLI, and
  Markdown SSG presets. Their playground base is the required `VITE_RIFTY_PLAYGROUND_URL`, so
  self-hosters explicitly choose their own origin or mount instead of receiving a false local
  fallback. Added an accessible mobile nav drawer, one-column mobile content, and a mobile-first
  Realms architecture view; browser regressions cover exact API copy, preset links, and zero
  page-level overflow at 390/360 px.
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
