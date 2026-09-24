# Changelog

## [Unreleased]

- Restore native `initialMessages` in fresh sessions; reject incomplete tool pairs, expose trace provenance and count only new-run usage (ADR-0466).

- Refuse pi-expandable commands inside `send` after resource discovery and budget/cancellation checks; first and later sends report the same error without model dispatch (ADR-0442).
- Load pi 0.85.1 project context/skills by default; resource reports, opt-outs and explicit reload. Preserve profile paragraphs; adopt custom-prompt tail (ADR-0440 supersedes ADR-0434 tail clause).
- `reload()` retries a failed startup read; `list` entries outside the listed directory are reported; unreadable ignore files skip silently as the CLI.
- Resource report lists `.pi/prompts` templates discovered as the CLI does (ignore rules, no dotfiles, non-recursive) as unsupported, never loaded, so hosts refuse exactly what pi would expand.

- Make the package public; add settings-free native StreamFn transport and
  truthful custom trace provenance (ADR-0436).
- Put shell status/exit/error/worker/effects and preview HTTP status in bounded
  model-facing result text; keep structured details.
- Keep generic network errors product-neutral; Playground owns its proxy help.

- Expose the shared coding policy for native consumers; retain the complete default browser prompt bytes.


- Declare a shared coding-profile metadata surface for external consumers (ADR-0434; RED scaffold).

- no-COI host over public sandbox.project: project policy, caller-owned mode
  changes and native Stop/Worker uncertainty; preserve SDK failure code/path. ADR-0426.
- Headless Pi 0.85.1 agent over public Workbench hosts; exact file tools, shell,
  optional diagnostics/preview, native consumer tools/instructions/fetch/streamFn.
- Retained history after provider failure, settled Stop outcomes, per-run limits,
  16 KiB text results and key-free session traces. ADR-0424.
