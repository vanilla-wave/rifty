---
kind: epic
status: draft
title: Isolate host agent tools — model-facing file and `node` tools over a sandbox, no outcome reading as success when files are lost
created: 2026-11-24
value: A Node service plugs ready tools (`write_file`, `read_file`, `list_files`, `edit_file`, `run_node`) over a `Sandbox` into its own LLM loop, with texts that tell the model exactly what happened — never a success when the run's files were lost or rolled back.
user_story: As a Node service running my own LLM loop over an isolate-host sandbox, I want neutral tool definitions with model-oriented texts, but today the only rifty tools are Pi `AgentTool`s inside `@riftydev/agent`, not exported, text-only, coupled to the workbench.
---

## Outcome

A tool set over `Sandbox` from `@riftydev/isolate-host`: `write_file`, `read_file`, `list_files`
(recursive, the template's directory hidden by default), `edit_file` (exact unique replacement,
no fuzzy match), `run_node(path, args)`. Each tool is `{ name, description, parameters: JSON Schema,
execute(args, signal) → Promise<string> }`; no dependency on Pi, workbench, sdk or browser code;
importable in plain Node ≥ 24 (a packed-package test in CI). The texts are tested: a host error
reads like Node's and names only sandbox paths; output truncation (`truncated`) and the tool's own
text limit are marked; a binary file in `read_file` is `binary, N bytes`; a killed run
(`termination: 'timeout' | 'memory'`, an abort) says the process was killed and what became of its
writes; `exitCode: 0` with `stateRefused` says the run's files were lost, why, and what to do —
never readable as success, pinned by its own test. Descriptions list the environment's limits: no
network, CommonJS only (`require`, not `import`), the guest's missing Web APIs, the template's
packages (read from the template), time, memory and size limits.

## User scenario

1. The service builds the tools over a sandbox created on a template and passes them to its LLM
   loop; the descriptions name the template's packages and the limits.
2. The model calls `write_file('main.js', …)`, `run_node('main.js', ['out.pptx'])`: the result
   text carries stdout/stderr/exit code and the files the run changed.
3. The model calls `read_file('out.pptx')` → `binary, N bytes`; `list_files()` lists `/workspace`
   recursively without the template.
4. `edit_file` with a non-unique or missing `old` → the exact-match failure text, file unchanged.
5. A run loops forever → `run_node` says it was killed by the time limit and what happened to the
   files it wrote; a run ends `exitCode: 0` with `stateRefused` → the text says its files were lost,
   the reason and the remedy.
6. The user stops the turn: the loop's `signal` reaches `execute`, the run is cancelled, the sandbox
   stays.

## Invariants

<!-- Drafted at FIT: blocked on the template goal's API (template listing, changed paths), the
killed-run decision (texts); `exec`'s `signal` landed (PR #431). False on main @ b3731e9c0:
`packages/agent/src/index.ts` exports no tools; tools are Pi `AgentTool` + TypeBox
(`tools.ts:1-3`, `:55-71`); `AgentFiles.read` is `string` only, a binary file is "Binary file is
not supported by text tools" (`sandbox-host.ts:58`); no `run_node`. -->

## Challenge

challenge: pending

## Decisions

- 2026-11-17 — user: «согласен» to «Файловые инструменты в перспективе: никакой второй независимой реализации; нужен общий набор инструментов, адаптированный под выбранный движок» (wrap-up 2026-11-17 :113) — the tools are one core shared with `@riftydev/agent`, adapted per host, never a second copy.
- 2026-11-24 — agent: the core is a new package with no Pi / workbench / sdk / browser dependency (requirements §4), which `@riftydev/agent` and the isolate-host adapter both use; a subpath of `@riftydev/isolate-host` would make the browser agent install isolated-vm. It is a third new npm name (`epics/isolate-host-npm-delivery`: first publication with a token). The name is set at FIT.
