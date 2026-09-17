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
