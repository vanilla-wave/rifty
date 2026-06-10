# ADR 0105: xterm addons and escape policy

Status: Accepted
Date: 2026-06-10

> TL;DR: use official xterm addons; keep browser-sensitive protocols host-gated.

## Context

Backlog asks for search, serialize/export, WebGL, Unicode 11, web links,
clipboard escape writes, and image output. These are established xterm addon
domains; hand-rolling would be brittle.

## Options considered

- Hand-roll protocols/features: fewer deps, higher maintenance and compat risk.
- Load every addon unconditionally and trust output: easy, unsafe in browser.
- Chosen: official addons with narrow wrapper options and host policy gates.

## Decision

- Depend on official fit, search, serialize, unicode11, web-links, webgl, and
  image addons.
- Expose text/HTML serialization helpers and a package export artifact builder.
- Support OSC 52 writes only; ignore/readback is not exposed.
- Support OSC 8 links with Ctrl/Cmd-open default and host-owned opener; local
  file links are resolved by playground allowlist.
- Keep `img` as optional shell command export; playground registers it as a demo
  producer, not a core builtin.

## Consequences

- Terminal features track xterm behavior instead of local clones.
- Browser safety remains host-owned for clipboard/link side effects.

## Acceptance

- [x] Addon option and serialization tests.
- [x] OSC 52 and OSC 8 tests.
- [x] Optional `img` command tests.
