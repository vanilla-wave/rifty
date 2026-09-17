# Project resources pickup — 2026-09-18

Authority: ready goal `docs/backlog/epics/agent-pi-project-resources/goal.md`.
Baseline: `7f8f4708e0d1ec6ee56de0b7ccdca339d94422ac`.

## Independent carrier decision

Fresh read-only resource_decision agent, DEC-2. Port CLI discovery/parser;
reuse core formatter. Core loses BOM, .agents nested markdown, changes
collision order and metadata warnings. ADR-0440 records alternatives.
Explicit agentDir and git boundary; global .agents disabled for oracle probe,
project overrides empty. Fixture-only report, no ambient resource contents.

```text
$ node docs/backlog/distribution/reference/agent-pi-project-resources-oracle.mjs
VERSIONS core=0.85.1 cli=0.85.1 node=v24.16.0
FIXTURE /var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-resource-decision-jwTp5u
CLI {
  "skills": [
    [
      "letter-collision",
      "<fixture>/project/.pi/skills/Q/SKILL.md"
    ],
    [
      "bom",
      "<fixture>/project/.pi/skills/bom/SKILL.md"
    ],
    [
      "declared",
      "<fixture>/project/.pi/skills/declared/SKILL.md"
    ],
    [
      "hidden",
      "<fixture>/project/.pi/skills/hidden/SKILL.md"
    ],
    [
      "pi-nested-skill",
      "<fixture>/project/.pi/skills/nested/deep/SKILL.md"
    ],
    [
      "pi-root",
      "<fixture>/project/.pi/skills/root.md"
    ],
    [
      "collision",
      "<fixture>/project/.pi/skills/z/SKILL.md"
    ],
    [
      "agents-nested-skill",
      "<fixture>/project/.agents/skills/nested/deep/SKILL.md"
    ],
    [
      "agents-nested-plain",
      "<fixture>/project/.agents/skills/nested/plain.md"
    ]
  ],
  "diagnostics": [
    [
      "collision",
      "name \"letter-collision\" collision",
      "<fixture>/project/.pi/skills/c/SKILL.md"
    ],
    [
      "collision",
      "name \"collision\" collision",
      "<fixture>/project/.agents/skills/z/SKILL.md"
    ],
    [
      "collision",
      "name \"collision\" collision",
      "<fixture>/home/.pi/agent/skills/z/SKILL.md"
    ]
  ]
}
CORE {
  "skills": [
    [
      "letter-collision",
      "<fixture>/project/.pi/skills/c/SKILL.md"
    ],
    [
      "declared",
      "<fixture>/project/.pi/skills/declared/SKILL.md"
    ],
    [
      "hidden",
      "<fixture>/project/.pi/skills/hidden/SKILL.md"
    ],
    [
      "declared",
      "<fixture>/project/.pi/skills/linked/SKILL.md"
    ],
    [
      "pi-nested-skill",
      "<fixture>/project/.pi/skills/nested/deep/SKILL.md"
    ],
    [
      "letter-collision",
      "<fixture>/project/.pi/skills/Q/SKILL.md"
    ],
    [
      "pi-root",
      "<fixture>/project/.pi/skills/root.md"
    ],
    [
      "collision",
      "<fixture>/project/.pi/skills/z/SKILL.md"
    ],
    [
      "agents-nested-skill",
      "<fixture>/project/.agents/skills/nested/deep/SKILL.md"
    ],
    [
      "agents-root",
      "<fixture>/project/.agents/skills/root.md"
    ],
    [
      "collision",
      "<fixture>/project/.agents/skills/z/SKILL.md"
    ]
  ],
  "diagnostics": [
    [
      "warning",
      "description is required",
      "<fixture>/project/.pi/skills/bom/SKILL.md"
    ],
    [
      "warning",
      "name \"letter-collision\" does not match parent directory \"c\"",
      "<fixture>/project/.pi/skills/c/SKILL.md"
    ],
    [
      "warning",
      "name \"declared\" does not match parent directory \"linked\"",
      "<fixture>/project/.pi/skills/linked/SKILL.md"
    ],
    [
      "warning",
      "name \"pi-nested-skill\" does not match parent directory \"deep\"",
      "<fixture>/project/.pi/skills/nested/deep/SKILL.md"
    ],
    [
      "warning",
      "name \"letter-collision\" does not match parent directory \"Q\"",
      "<fixture>/project/.pi/skills/Q/SKILL.md"
    ],
    [
      "warning",
      "name \"pi-root\" does not match parent directory \"skills\"",
      "<fixture>/project/.pi/skills/root.md"
    ],
    [
      "warning",
      "name \"collision\" does not match parent directory \"z\"",
      "<fixture>/project/.pi/skills/z/SKILL.md"
    ],
    [
      "warning",
      "name \"agents-nested-skill\" does not match parent directory \"deep\"",
      "<fixture>/project/.agents/skills/nested/deep/SKILL.md"
    ],
    [
      "warning",
      "name \"agents-root\" does not match parent directory \"skills\"",
      "<fixture>/project/.agents/skills/root.md"
    ],
    [
      "warning",
      "name \"collision\" does not match parent directory \"z\"",
      "<fixture>/project/.agents/skills/z/SKILL.md"
    ]
  ]
}
FORMAT equality after approved tool-line substitution: true
```

## Executed RED

```text
$ pnpm exec vitest run tools/agent-bench/src/project-resources.test.ts
Test Files 1 failed (1); Tests 10 failed (10).
All failures assertions: absent context/skills/report/no-file notice.
No import/typecheck failure. Pi runs against the same fixture on Node;
agent uses real MemoryVfs and scripted external model transport.

$ RIFTY_PLAYGROUND_PORT=5391 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts -g 'project resources load'
1 failed: expected provider system prompt to contain "Answer in pirate speak."
Real browser/workbench, full pi loop and read_file succeeded; context absent.
```

Raw RED logs kept at `/tmp/pi-resources-red.log`,
`/tmp/pi-resources-e2e-red.log`; committed tests reproduce the failures.

## Scope and carriers

- Host root/cwd: workbench `/`, sandbox `project.root`; existing rooted tools.
- User values unchanged from FIT; three draft carriers combined (RDY-5).
- No resources: preserve profile paragraphs, adopt I3 tail; route's old
  unchanged-entire-prompt note corrected, goal unchanged.
- User skill locations are host-readable files; options supply metadata,
  consumer writes content through its filesystem. No ambient home scan.
- Existing built-in filesystem surfaces cannot create symlinks; no symlink
  projection added. CLI symlink behavior measured, not claimed on those hosts.
- Preview/no-file → commands: cached unread report until explicit reload.
- Oracle dependency already belongs to agent-bench; test is default Vitest unit lane.

## Contract review correction

B1 accepted: the first amended unit run used `import.meta.resolve`, unavailable
in Vitest SSR; six cases failed before assertions. Replaced with explicit
installed CLI module URLs (CLI exports only import condition). Re-run:
10 assertion failures, zero import errors. Prior report overstated that run;
`/tmp/pi-resources-red.log` contains the corrected executed result.

Native case probe: on this volume `AGENTS.MD` is also reachable as `AGENTS.md`;
pi chooses the latter candidate spelling. MemoryVfs is case-sensitive.
All five VFS assertions always run against pi's formatter with the actual
fixture spelling; direct native discovery identity is additionally asserted
when a real `stat(lowercase-name)` probe establishes a case-sensitive volume
(including Linux CI). No entire case is skipped. Independent reviewer approved
this carrier separation; corrected RED still has 10 assertion failures.

## Implementation proof

- `pnpm exec vitest run tools/agent-bench/src/project-resources.test.ts packages/agent/src`: 33 passed. CLI differential + startup-before-send event, independent opt-outs, report isolation, reload admission/history, no-file→file transition, read/parse diagnostics, empty tail.
- Unicode collision RED: native CLI selected U+E000 directory, JS UTF-16 comparator selected U+10000. Full differential case failed (1 failed / 16 passed, `/tmp/pi-resources-unicode-red.log`); compare UTF-8 bytes at resource enumeration fixes the ordering. Same case GREEN, no weakened oracle.
- `RIFTY_PLAYGROUND_PORT=5391 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts -g 'project resources load'`: 1 passed. Real workbench, Pi loop, provider prompt and read_file, editor model change → save → cached turn → /reload → changed turn; diagnostics visible. `/tmp/pi-project-resources.png` inspected.
- Browser test delivery correction: container click did not focus Monaco; direct select-all appended text. Existing ADR-0166 `__riftySetEditorValue` drives the real model-change/save path deterministically. Assert editor replacement and saved toast before reload; provider assertions unchanged.
- `RIFTY_PLAYGROUND_PORT=5392 pnpm exec playwright test --config playwright.no-coi.config.ts --project=chromium tests/no-coi/no-coi-pi-agent.spec.ts -g 'sandbox project resources'`: 1 passed. Actual sandbox project fs and agent adapter; root bound, both skill directories, read_file, cached turn and reload.
- Mechanism sweep: `session.ts` owns existing active/disposed admission. Initial load + one admitted reload remain there; no queue, lock service or host-specific state owner. `send` waits for admitted load; reload rejects during runs/reloads; dispose settles reads before host close.
- PR-4: default-prompt golden deliberately changes only the ADR-0440 tail (cwd last, date/profile and consumer text preserved). No policy paragraph weakened. New acceptance tests retain original required model-visible results.

Context identity follow-up: real pi 0.85.1 `loadProjectContextFiles({cwd,
agentDir: cwd})` returns one AGENTS.md. Our same-input probe returned two;
committed differential test RED (1 failed / 17 skipped,
`/tmp/pi-context-identity-test-red.log`). Skip the selected project path when
already supplied globally; retain first-candidate selection. Full relevant
suite then 34 passed. This remains I1/I5 work, no scope change.
