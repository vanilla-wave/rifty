# ADR 0109: OSC 52 clipboard write

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: support OSC 52 writes, ignore reads

## Context

Backlog asks for OSC 52 clipboard support but readback is unsafe in a browser.
Terminal output can request clipboard writes with `OSC 52 ; c ; base64 BEL/ST`.

## Decision

`RiftyTerminal.write()` strips OSC 52 sequences before xterm render, decodes
bounded base64 payloads, and writes them through the existing clipboard port.

- accept clipboard target `c` or empty target;
- ignore read requests (`?`) and non-clipboard targets;
- ignore invalid / oversized payloads;
- never expose clipboard contents back to terminal output.

## Consequences

- Browser security stays write-only.
- Clipboard writes remain best-effort and never break terminal output.
- Large payload cap avoids accidental memory spikes.

## Acceptance

- [x] Parser tests cover BEL/ST, invalid payload, readback ignore.
- [x] `RiftyTerminal.write()` routes decoded writes through clipboard port.
- [x] `packages/terminal` typecheck passes.
