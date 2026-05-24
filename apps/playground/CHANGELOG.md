# Changelog

## [Unreleased]

### Added

- Initial Solid UI scaffold: header + Monaco editor + xterm.js terminal in a 1:1 split, plus Run / Reset buttons.
- COOP/COEP headers in `vite.config.ts` (D-001) for cross-origin isolation, both in `server` and `preview` modes.
- Capabilities-detection fallback panel that explains which feature is missing if the browser isn't cross-origin-isolated.
- Service Worker registration on mount; failures surface in the terminal (red).
- `useRuntime` adapter as the single bridge between Solid signals and the framework-agnostic runtime controller (D-002).
- Dev proxy `/npm-registry → registry.npmjs.org` to make M9 wiring testable from day 1 (D-004).
