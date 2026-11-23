# Changelog

## [Unreleased]

- Pi core/ai 0.85.1 → 1.6.0. Compaction, `convertToLlm` and the skills formatter are ported from pi CLI 1.6.0 (`src/pi-cli/`, MIT notice in `THIRD_PARTY_NOTICES.md`) and differential-tested against the real CLI (ADR-0569). Follows CLI 1.6.0: summary requests carry no `maxTokens`, new turn-prefix prompt, thinking left out of summaries, projected estimates count the system prompt, a length stop below the model limit gets one compact-and-continue, failed recovery emits the CLI's `compaction` end event. Abort-skipped tool calls get Pi's own "Operation aborted" result (receipt `cancelled/applied:no`); the synthetic completion is removed. Prompt changes enter history as `system` messages (`sections.prompt`); transcripts, archives and `initialMessages` admit them. `project_context` uses CLI 1.x bytes; prompt profile id `pi-1.6.0+rifty-adapter-v2`. `Type` stays public via a direct `typebox` 1.3.27 dependency (ADR-0570); tool `parameters` accept any JSON Schema, validation messages are pi-schema's; `Type.Refine`/`Type.Codec`/`BigInt`/`Undefined`/`Void` parameters now throw `NotImplementedError` (pi 1.x validates JSON Schema only). `CompactionSummaryMessage` type exported. Breaking for custom `streamFn`/providers: they receive pi 1.x `TranscriptContext` (prompt and tools as system messages, no `systemPrompt`/`tools` fields).

- The no-COI commands-mode host note no longer claims a fresh environment: fresh cwd/env in one shared JS realm, with the measured persisting state (compat process.md "Shared realm across no-COI `node` invocations").

- Prompt host facts state the real shell subset (heredoc/compound/`$(…)`/process substitution/fd redirects fail loudly, other bash features may differ, no python or native binaries) instead of claiming every unsupported shell feature fails loudly; no-COI notes add that background `&` is rejected.

- Keep transcript notice types aligned with emitted notice events when archive receipts are enabled.

- Describe connected/unconnected SDK registry accurately in prompt notes; remove the host-only dependency instruction. Ordinary shell npm install uses SDK admission and policy (ADR-0487).

- Export a pure native-event transcript reducer with stable rows, streaming/final messages, cancelled tools, output and continuation notices; budget terminals preserve prior history (ADR-0485).

- Sandbox agent hosts accept distinct files/shell policies over one root, enforced by SDK project handles; reference README defaults unrestricted (ADR-0484).

- Built-in OpenAI catalog entries support `textOnlyContent`; native transport sends strings and refuses image prompts/history before network (ADR-0483).

- Shell results preserve streamed stdout/stderr order after the status header.
- Optional shared OPFS conversation archive: original messages survive reset/compaction/reload; read-only cross-project search and pagination, durable receipts and visible storage errors; host-restored `initialMessages` are counted (`restoredMessageCount`), not re-archived; `archive_search` lists newest first, skips image bytes and reports bounded `corrupt` entries (`corruptCount` total) without hiding healthy conversations; files written before `restoredMessageCount` read as 0 restored (ADR-0482).

- Repeated-call detection ignores mutation host-diagnostics timing (pending vs settled); README/ADR-0475 note state exactly which consumer results get budget receipts.
- Breaking: scrub built-in keys and declared `secrets` once at provider ingress in provider error text only (`errorMessage`, retry/compaction errors, thrown request errors; assistant text/thinking stay raw); headers are no longer implicit secrets; export-time redaction removed (ADR-0479).

- Clarify native assistant retries versus the prohibition on tool-action replay.

- Default600s and model-facing budget receipts; exact-edit hints, third-repeat native steering, bounded post-mutation diagnostics and shared recipe v2 with opt-out.

- Native Pi retry/compaction, bounded context recovery, restorable summary details and full current-session attempt usage.

- Keep native trace statuses and event/message tags valid when a catalog header matches a protocol word; mask credentials in payload values/keys, preserving ordinary tool metadata.

- Accept native image prompts, including image-only input; reject text-only/binary mismatches before dispatch.

- Breaking: native pi Models catalog replaces settings/streamFn session forms; per-model defaults, active setModel and effective redacted trace.

- Restore native `initialMessages` in fresh sessions; validate required native fields and tool pairs, expose trace provenance and count only new-run usage (ADR-0466).

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
