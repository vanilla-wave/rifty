# Backlog

One item per file: `docs/backlog/<area>/<slug>.md`. Slug = filename without `.md`.

## Areas

`vfs`, `kernel`, `runtime-js`, `runtime-wasi`, `net`, `service-worker`, `npm-client`, `shell`, `playground`, `toolchain-build`, `protocol`, `process-meta`, `perf`, `terminal`, `distribution`.

## Frontmatter

Between the first two `---` lines. Required keys:

- `area` — must equal the parent folder name (and be a known area)
- `status` — one of `active` | `parked` | `blocked`
- `title` — short human label
- `created` — `YYYY-MM-DD`
- `why` — one line: why this is on the backlog

Optional: `sources` (refs), `code` (paths). Arrays as `[a, b]`.

See `TEMPLATE.md`.

## Statuses

- `active` — being worked / next up
- `parked` — deferred, gate not yet met
- `blocked` — waiting on another item / external

## Code markers

Mark deferred work in source with:

```
// TODO(backlog: <area>/<slug>)
```

Every marker must resolve to an existing item file.

## Validation

`pnpm backlog:check` runs `tools/backlog/check.mjs`:

- validates frontmatter (required keys, status enum, area = folder = known)
- resolves every code marker to an existing `<area>/<slug>` item
- prints counts per area × status

Fails CI on any violation.
