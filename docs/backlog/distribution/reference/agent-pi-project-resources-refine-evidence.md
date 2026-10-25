# agent-pi-project-resources — refine/FIT evidence (2026-09-16)

Goal: agent-pi-project-resources (completed; accepted goal preserved at `5972a3c0b`). Driver: Claude (refine session, user present). Main at `51440931a`.

## Request (verbatim)

> давай спроектируем. Чтобы поведение агента в нашей песочнице было максимально близко в обычному

Preceded by: "Глянь текущая версия pi агента умеет в скиллы и AGENTS.md?" — answered: pi CLI yes, `@riftydev/agent` no.

## User answers (AskUserQuestion; question text and chosen option verbatim)

1. Q: «Какие проектные ресурсы обычного pi агент в песочнице должен подхватывать? (packages/`pi install` — вне scope по умолчанию)» — multi-select over: Context files + skills / Prompt templates + /skill: команды / SYSTEM.md/APPEND_SYSTEM.md + settings.json / Extensions (.pi/extensions/*.ts). A: **Context files + skills** only.
2. Q: «Доверие к инструкциям из проекта: склонированный чужой репо несёт AGENTS.md/SKILL.md → они попадают в system prompt (prompt injection). Как по умолчанию?» — options: Вкл. по умолчанию, opt-out (описание: как pi SDK; сессия отдаёт список загруженного событием; опции `contextFiles:false`/`skills:false` = `--no-context-files`/`--no-skills`) / Выкл. по умолчанию, opt-in / Спрашивать в playground UI, headless — вкл. A: **Вкл. по умолчанию, opt-out**.
3. Q: «Форма промпта / критерий приёмки. Байт-в-байт с default-pi недостижимо (pi вшивает абсолютные пути своих docs). Что считаем паритетом?» — options: pi custom-prompt режим (описание: наш профиль = `--system-prompt` pi; далее строго как у pi: append (сюда `instructions`) → `<project_context>` → skills → cwd; приёмка: блоки байт-равны pi на том же проекте; tool-имена и API 0.1.0 не меняются) / Полная default-форма pi + переименование тулов. A: **pi custom-prompt режим**.
4. Q: «Пользователь правит AGENTS.md/SKILL.md в редакторе playground посреди сессии. Когда правки применяются?» — options: Со следующего хода / Как pi: старт сессии + явный reload (описание: `session.reload()` + `/reload` в чате playground). A: **Как pi: старт сессии + явный reload**.
5. Q: «Обычный pi кроме проекта грузит пользовательский уровень: `~/.pi/agent/AGENTS.md` (первым в `<project_context>`), `~/.pi/agent/skills`, `~/.agents/skills`. В песочнице «home» пользователя нет. Откуда брать пользовательский уровень?» — options: Через опции сессии (описание: consumer передаёт user-level context/skills явно; встают на место global-файла pi; никакого скана home в VFS) / Сканировать home в VFS песочницы / Не нужен. A: **Через опции сессии**.

## Versions

- `@earendil-works/pi-coding-agent` 0.85.1 (npm latest 2026-09-05, same as workspace pin); `@earendil-works/pi-agent-core` 0.85.1; node v24.16.0.
- Package dirs: `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.85.1_ws@8.18.3/node_modules/@earendil-works/pi-coding-agent` (CA), `node_modules/.pnpm/@earendil-works+pi-agent-core@0.85.1_ws@8.18.3/node_modules/@earendil-works/pi-agent-core` (AC).

## Probe — pi 0.85.1 assembled prompt on a fixture tree

Fixture: `/tmp/pi-parity-probe/{AGENTS.md, sub/CLAUDE.md, .pi/skills/deploy/SKILL.md, .pi/skills/hidden/SKILL.md (disable-model-invocation: true), .pi/prompts/review.md}`; agentDir `/tmp/pi-parity-home/AGENTS.md`.

```js
// /tmp/pi-parity-probe2.mjs (disposable)
import { VERSION, DefaultResourceLoader } from '<CA>/dist/index.js';
import { buildSystemPrompt } from '<CA>/dist/core/system-prompt.js';
import { createCodingToolDefinitions } from '<CA>/dist/core/tools/index.js';
const cwd = '/tmp/pi-parity-probe'; const agentDir = '/tmp/pi-parity-home';
for (const trust of [false, true]) {
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload(trust ? { resolveProjectTrust: async () => true } : undefined);
  const sk = loader.getSkills();
  // … print project skills / prompts / diagnostics …
  const selected = ['read','bash','edit','write'];
  const defs = createCodingToolDefinitions(cwd); const byName = Object.fromEntries(defs.map(d => [d.name, d]));
  const prompt = buildSystemPrompt({ cwd, selectedTools: selected,
    toolSnippets: Object.fromEntries(selected.map(n => [n, byName[n]?.promptSnippet]).filter(([, v]) => v)),
    promptGuidelines: selected.flatMap(n => byName[n]?.promptGuidelines ?? []),
    contextFiles: loader.getAgentsFiles().agentsFiles, skills: sk.skills.filter(s => s.filePath.startsWith(cwd)) });
  console.log(prompt);
}
```

Output (`node /tmp/pi-parity-probe2.mjs`):

```
pi-coding-agent VERSION 0.85.1 node v24.16.0 cwd /tmp/pi-parity-probe
trust=false project skills: [ 'deploy dmi=false', 'hidden dmi=true' ] user skills count: 28 prompts: [ 'review' ] diag: 0
trust=true  project skills: [ 'deploy dmi=false', 'hidden dmi=true' ] user skills count: 28 prompts: [ 'review' ] diag: 0
```

Prompt head (default branch; tool snippets + guidelines):

```
You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- You can inspect PI_* environment variables for current model and session details.
- Use edit for precise changes (edits[].oldText must match exactly)
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when the user asks about pi itself, …):
- Main documentation: <absolute path into the installing machine's node_modules>/README.md
…
```

Context block (probe 1, cwd `/tmp/pi-parity-probe/sub`):

```
contextFiles order: [ '/tmp/pi-parity-home/AGENTS.md', '/tmp/pi-parity-probe/AGENTS.md', '/tmp/pi-parity-probe/sub/CLAUDE.md' ]

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/tmp/pi-parity-home/AGENTS.md">
# Global
Global instruction.

</project_instructions>

<project_instructions path="/tmp/pi-parity-probe/AGENTS.md">
# Root rules
Always answer in pirate speak.

</project_instructions>

<project_instructions path="/tmp/pi-parity-probe/sub/CLAUDE.md">
# Sub rules
Prefer tabs.

</project_instructions>

</project_context>
```

Skills block + cwd (probe 2, cwd `/tmp/pi-parity-probe`):

```
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>deploy</name>
    <description>Deploy the app to staging</description>
    <location>/tmp/pi-parity-probe/.pi/skills/deploy/SKILL.md</location>
  </skill>
</available_skills>
Current working directory: /tmp/pi-parity-probe
```

Facts the probe settles:

- `.pi/skills` is resolved in cwd only (probe 1 from `sub/` saw no project skills); `.agents/skills` walks ancestors (`CA/dist/core/package-manager.js:1985-2001`).
- Context files come from cwd and its ancestors only (probe 1 from `sub/`: global + root + `sub/`; probe 2 from root: global + root) — descendants are never loaded (`CA/dist/core/resource-loader.js:92-106`).
- `formatSkillsForPrompt(skills, fileReadTool = "read")` special-cases only `"read"`; any other name yields "Use bash to load a skill's file…" (`CA/dist/core/skills.js:275-284`).
- `.pi/settings.json` `skills[]` enable/disable overrides shape discovery (`CA/dist/core/package-manager.js:1958-1995`) — out of scope here, so I2 is bounded to trees without overrides.
- `hidden` (`disable-model-invocation: true`) is loaded but excluded from the block.
- The SDK loader loads project skills/prompts without a trust resolver; the trust prompt is a TUI concern.
- The default branch embeds absolute docs paths (`CA/dist/core/system-prompt.js:37-39`) → whole-prompt byte parity is unattainable.
- Custom-prompt branch (`CA/dist/core/system-prompt.js:15-34`): custom prompt → `appendSystemPrompt` → `<project_context>` → `formatSkillsForPrompt(skills, skillFileReadTool)` → `Current working directory`; `skillFileReadTool = ["read","bash"].find(t => tools.includes(t))` (`:14`), block omitted when neither is active.

## Inventory (read-only sweep of CA/AC dist, file:line)

- Context files: candidates `CA/dist/core/resource-loader.js:33`; global first `:87-91`; walk-up with `unshift` `:92-106`; worktree shadowing `:59-79`; `--no-context-files` `CA/dist/cli/args.js:173-174`; read once per loader `reload()` (`CA/dist/core/agent-session.js:751-767`).
- Skills: loader `CA/dist/core/skills.js` (frontmatter `:61-89`, `:231-262`; collisions `:329-342`; formatter `:275-298`); dirs `CA/dist/core/package-manager.js:1960-2019`.
- `/reload` hot reload: `CA/CHANGELOG.md:3450` (0.50.0).
- `pi-agent-core` harness: `loadSkills(env, dirs, context)` / `loadSourcedSkills` (`AC/dist/harness/skills.d.ts:24-27`), `formatSkillsForSystemPrompt` (`AC/dist/harness/system-prompt.js:1-21`, zero internal callers), `ExecutionEnv = FileSystem & Shell` (`AC/dist/harness/types.d.ts:289-290`), only `NodeExecutionEnv` shipped (`AC/dist/harness/env/nodejs.d.ts`); harness tools `createRead/Bash/Edit/WriteTool` import no `node:*`. No AGENTS.md loader in core.
- Ours: prompt assembly `packages/agent/src/prompt.ts:8-36`; profile literals `prompt-profile.ts:11-20`; per-turn refresh `session.ts:76-113`; fixture test self-referential `prompt.test.ts:7-22`; playground passes no instructions `apps/playground/src/ai/AiChatPanel.tsx:262-266`; bench native lane flags `tools/agent-bench/src/lanes/local-reference.ts:104-123` (`--no-skills --no-context-files --no-prompt-templates --no-extensions`).

## False on main (`51440931a`)

```
$ grep -rn -iE "AGENTS\.md|SKILL\.md|skills|contextFiles|\.pi/" packages/agent/src packages/agent/README.md packages/agent/CHANGELOG.md
(no output)
$ grep -n "reload" packages/agent/src/types.ts apps/playground/src/ai/AiChatPanel.tsx
(no output)
```

`docs/backlog`, `docs/adr/README.md` §Declined concepts, `docs/process/traps.md`: no item, epic or declined row about agent context files, skills, prompt templates or extensions (Explore sweep, 2026-09-16).

## Critic (fresh read-only premise check, §Challenge; verdict verbatim)

`challenge: 2026-09-16 — clear | 5 problems`

1. Acceptance "byte-comparable system prompt" is unattainable — pi's default branch embeds installer-absolute doc paths (`core/system-prompt.js:37-39`, `config.js:1-4`); the user asked for behavior, not bytes.
2. Cheaper route unweighed: pi's own `customPrompt` branch (`core/system-prompt.js:15-34`) already emits `<project_context>` + skills + cwd, making fork 2(b) genuine pi behavior and 2(a)'s breaking rename unjustified by the stated value.
3. Missing authority on trusting project-carried AGENTS.md/SKILL.md from a cloned repo (prompt injection); no user answer, no ADR.
4. Missing authority on default-on scope across published-package surfaces and on precedence between consumer `instructions` (appended last, `prompt.ts:31-34`) and `<project_context>`.
5. Agent-written exclusions treated as settled: user-level `~/.pi` resources, and silent skill drop when `capabilities.files` is absent (`core/system-prompt.js:14,30`) — both need the user, per `readiness.md:113-114`.

Resolution: 1–2 → prompt question (user chose pi custom-prompt mode); 3–4 → trust question (default-on, opt-out) + I3 order; 5 → user-level question (session options) + I6 loud statement.

## Final written-result check (`RDY-6`, fit.md 8)

Fresh read-only Explore agents (claude-opus-5), each given the request, verbatim answers, the draft set and authority files; no author context.

- Pass 1 — `final-check: 2026-09-16 — FAIL | 3 blockers, 7 concerns`: B1 I3 order contradiction (cwd/date/instructions vs pi custom branch); B2 scenario promised `sub/CLAUDE.md` loaded although host cwd = root; B3 I2 ignored `.pi/settings.json` skill overrides; C1 Challenge 4 attribution; C2 I6 authority; C3 skills header (`formatSkillsForPrompt` special-cases only `read`); C4 packages absent from I7; C5 verdict wording; C6 rejected-route form; C7 evidence lacked question texts. All corrected (goal `## Decisions` cwd / skills header / date line / no-file-access host; I2 bound; I7 + `.pi/npm`; question texts above).
- Pass 2 (after edits) — `final-check: 2026-09-16 — PASS | 0 blockers, 6 concerns`: citations (`types.ts:47-49`, ADR-0424 §7), ADR-0434 §3 amendment named in the item-1 ADR scope, scenario 2 qualified by the I2 deviation, packages attributed to the accepted question text, I4 extended with the start-time report, I5 falseness note. All applied.
- Pass 3 (diff re-pass) — `final-check: 2026-09-16 — PASS | 0 blockers, 4 concerns`: contract.spec citation off-by-one, compat ❌ for all I7 kinds, `refresh:` line attribution, I5 wording vs map walk-up fog. All applied inline (formatting/attribution only).

Reviewed revision: the commit carrying this file. Status flipped to `ready` after pass 3.
