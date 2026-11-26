# Shared WPT harness

Runs Node v24.16.0's vendored web-platform-tests on a rifty host and compares each subtest (name,
status, message) with **live Node** on the same file — never with Node's `test/wpt/status/*`
files, which lag (goal `isolate-guest-web-api`, `reference/wpt`). A subtest Node has and the
guest lacks is a difference.

- `fixtures/` — files copied unchanged from Node v24.16.0 `test/fixtures/wpt/` (WPT paths kept),
  each pinned in `fixtures.sha256.json`; `fixtures/LICENSE.md` is WPT's (3-Clause BSD). Test
  fixture only: outside every published package.
- `harness.ts` — `wptFile(test)`: one CommonJS file = shim (as Node's `test/common/wpt/worker.js`:
  `self`, `GLOBAL`, `location`, `META_TITLE`) + `resources/testharness.js` + `META: script=`
  dependencies + the test; it runs unchanged as `node t.cjs` and on the host. `inNode(file,
  timeoutMs?)`, `parseReport(run)`: a result only from a clean end — exit 0, no `termination`,
  empty stderr — else `unclean end: …` with no subtests (`{ stderr: true }`: a file whose process
  warnings Node prints too — stderr, pid masked, is compared instead of refused); `differences(node, guest, excluded)`,
  which also reports an oracle that did not end `OK`; `coverageProblems(dir, run, notRun)`: every
  vendored `.any.js` under `dir` is run or listed as not run, every run file vendored. `META: variant=`, `global=`, `timeout=` are
  ignored (one run per file, the harness's default timeout).
- A host runner: `packages/isolate-host/tests/wpt-guest.ts` (`runWpt(test)`; `inGuest(file,
  timeoutMs?)`, a sandbox `exec`); its own faults: `wpt-harness.test.ts`.

Add a WPT file: copy it and its `META: script=` dependencies from Node's
`test/fixtures/wpt/` at the pinned tag to `fixtures/<same path>`, add their sha256 to
`fixtures.sha256.json`, list the file in your test with its excluded subtest names (each must
still differ from Node, else the exclusion is reported stale). A file you do not run: list it with
guest code that prints `gap` while its reason holds (`NOT_RUN` in
`packages/isolate-host/tests/wpt-fileapi.test.ts`), so it turns red when the file can run; assert
`coverageProblems(<your dir>, run, notRun)` is empty, so a file dropped from both lists is red. A file
that reads fixtures through
`fetch` needs a `fetch` mock in `wptFile` (Node's runner has one; none is needed yet).
