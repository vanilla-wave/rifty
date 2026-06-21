# @riftydev/landing

## Unreleased

- Explorer review fixes: Realms view is now interactive — lane cards hover/click to highlight
  node + neighbours and drive a Realms inspector (hover wins over pin); active realm lane highlights
  in realm color during scenario playback (ext→page); per-realm lane tint + bounded scroll viewport
  with remembered scroll position. `mountExplorer` returns a disposer (removes window listeners,
  clears scenario + remeasure timers) for re-mount safety. Honesty: terminal role says
  "host-provided ghost-text completions" (not "AI"); hero meta says "Chromium-first".
- Rebuilt `rifty.dev` as a hi-fi Vite + vanilla-TS page with an embedded interactive architecture
  explorer (drag/pan/zoom graph, 6 BFS-animated scenarios, Schema/Realms/Hybrid views). Lime accent
  + rift mark hardcoded. Honest copy: preview buffered (M12), Chromium-first, CEIL gaps visible.
  Netlify build moved to the monorepo-root Vite build; headers/redirects shipped via `public/`.
- Nav gains an "Open playground" accent exit → `play.rifty.dev` (restores the funnel the old static
  page had). Netlify CI now installs + runs the Vite build and deploys `apps/landing/dist`
  (`--no-build`); the landing smoke check targets the new page title. Integration test
  `tests/integration/landing-static.test.ts` updated for the Vite SPA shell + `public/_headers`.
- (prev) Added the static `rifty.dev` landing page and Netlify headers/redirects.
