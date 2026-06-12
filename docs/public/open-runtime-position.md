# Open runtime position

rifty's public position is open, self-hostable, browser-local runtime infrastructure. It does not
claim full Node compatibility. Compatibility claims live in the matrices, with partial and
unsupported rows kept visible.

## First-party licence

- Root licence: MIT (`LICENSE`).
- Publish sync writes `license: "MIT"` into each publishable package manifest.
- Release flow copies the root `LICENSE` into each package before publish.
- Transitive dependency licence audit is tracked separately:
  `docs/backlog/distribution/dependency-license-audit.md`.

This is not legal advice and does not claim every transitive dependency is MIT/Apache.

## Runtime posture

| Project | Runtime posture | Self-host posture | Claim boundary |
|---|---|---|---|
| WebContainers | proprietary runtime; MIT client shim loads StackBlitz-hosted code | gated / Enterprise per research note | stronger ecosystem coverage, not open runtime ownership |
| CodeSandbox Nodebox | source-available Sustainable Use; no commercial embed per research note | not the rifty target | stalled since 2023-11 per research note |
| CheerpX / WebVM | proprietary engine, CDN/commercial terms per research note | commercial-gated | full-system emulation, not lightweight Node-compatible runtime |
| Sandpack | Apache-2.0 UI kit | self-hostable UI | not a Node runtime |
| rifty | MIT first-party packages over browser APIs | host from your own origin | Node-compatible where tested; unsupported gaps stay loud |

## Trust model

Open and self-hostable means the host can own and audit the runtime. It does not mean the browser
becomes a VM-grade hostile-code sandbox. rifty's security/resource posture is documented in the
[trust model](./trust-model.md): cooperative browser-local execution, cross-origin isolation as a
SharedArrayBuffer prerequisite, and no hard CPU, memory, spawn, or egress policy yet.

## Honest compatibility

Use `docs/public/compat/` as the pitch:

- Green rows mean implemented and tested.
- Partial rows mean caveated or incomplete.
- Unsupported rows mean loud and documented.

Start with:

- `compat/modules.md`
- `compat/buffer.md`
- `compat/wasi.md`
- `compat/incompatible-packages.md`

For project-level claims like Express, Vite, and npm install, link back to `docs/ROADMAP.md` until
generated project matrices exist.
