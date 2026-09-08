# Issue #319 refine evidence — 2026-09-08

## Sources and user answers

- Original request: `$rifty-refine давай разберем https://github.com/vanilla-wave/rifty/issues/319 и придумаем, что с этим можно сделать`.
- Round 1 asked whether closing/reopening after a manual node_modules edit should restore packages or preserve edits until explicit install. User first selected restore, then requested «покажи вопрос еще раз».
- Definitive repeated-round answer: «Сохранять правки при открытии; восстановление — только по явному install». The earlier restore choice is superseded.
- Subsequent steering: «Проверь еще ПР 316 там были приняты некоторые решения, возможно будет полезно для контекста».
- [Issue #319](https://github.com/vanilla-wave/rifty/issues/319), body + comments read with `gh issue view 319 --repo vanilla-wave/rifty --json title,body,comments,url`; no comments at read time.

The issue's published rifty 0.6.0 / Vite 7.3.6 timings are downstream observations:
23,655 files / 94.86 MB; post-boot 15.72 s, including 14.99 s flush; write+mkdir
dedup ~1.04 s; combined optimized total reopen median 6.88 s versus control
24.17 s. Not an attached reproducible Vite fixture, not timings of current main,
not an upstream latency target. Same-length React corruption, deletion and
handle-cache fault checks are downstream evidence only.

## PR #316 — decisions, not shipped SDK capability

Read via `gh pr view 316 --repo vanilla-wave/rifty --json body,files,comments,reviews,state,headRefOid`
and `gh api repos/vanilla-wave/rifty/contents/<path>?ref=fd829ca42ba698c168e5442278a3e5d50ffbbc7f`.
Source revision, not a rolling branch reference:

- [Goal I8 and Decisions](https://github.com/vanilla-wave/rifty/blob/fd829ca42ba698c168e5442278a3e5d50ffbbc7f/docs/backlog/epics/self-hosted-snapshot-workbench/goal.md): initial-deployment-only default; saved files win even after snapshotId changes; incompatible saved state fails without changing bytes; updates are explicit.
- [Application policy](https://github.com/vanilla-wave/rifty/blob/fd829ca42ba698c168e5442278a3e5d50ffbbc7f/docs/backlog/distribution/workbench-snapshot-application-policy.md): missing install trust does not mean absent project; generic explicit overwrite/error conflicts; no automatic install merely to manufacture a clean claim.
- [Raw decision/evidence record](https://github.com/vanilla-wave/rifty/blob/fd829ca42ba698c168e5442278a3e5d50ffbbc7f/docs/backlog/distribution/reference/embedder-gaps-evidence.md): rounds 2/3 chose preserve/stop and generic file conflicts.
- [Storage namespace](https://github.com/vanilla-wave/rifty/blob/fd829ca42ba698c168e5442278a3e5d50ffbbc7f/docs/backlog/vfs/workbench-storage-namespace.md): paired-surface root selection has a separate owner; this goal must compose with it if/when it lands.

PR #316's scope explicitly excludes no-COI SDK. Its producer, snapshot modes,
namespace, recovery, preview and production crash obligations are not adopted
here. Its preserve-before-explicit-update decision supports the current user's
answer; neither a draft contract nor its accepted decision proves shipped code.

## Material assumptions — source → consequence → authority

| Source/action | Observable consequence | Authority / remaining owner |
|---|---|---|
| Repeated round 1; changed dependency bytes | Preserve during open; explicit install owns repair | User; consistent with ADR-0307 |
| ADR-0307; extra/temp file or deleted dependency | No whole-tree surveillance; normal execution may use changed bytes or fail on missing module | Existing decision, not a new corruption-repair promise |
| Issue requires saved-state validation; missing/unknown prior installation evidence | No silent adoption/reinstall; preserve bytes and require install if compatibility cannot be proven without mutation | User's explicit-install choice + issue's explicit failure option; PR #316 context |
| Changed package.json/lock/SDK install policy | Revalidate request/policy authority; incompatible proof cannot authorize activation or automatic repair | Existing identity owners; public mechanism/upgrade validation is agent-owned |
| Full page recreation vs same-page restart | Reopen cannot rely solely on the old live host object | Issue's new sandbox scenario + user's close/reopen; ADR-0377 limits existing snapshot lifetime |
| Install/build success with failed native write | Reject; clean own-worker flush does not attest foreign writes or crash-atomic trees | Issue + OPFS failure report; existing works tier |
| Failed preload represented as empty bytes | Never use that fallback as equality, activation or recovery proof | Existing preload finding + Fidelity; failure location is agent-owned |
| OPFS handle reuse | Fresh getFile/read, deletion/recreation and old-view invalidation/native semantics remain required | Issue; exact wrapper/cache mechanism is agent-owned |
| Vite representative; generic no-COI admitted packages | No Vite identity condition in infrastructure | ADR-0375 |
| Replay cache retained in issue fixture | No registry on unchanged warm-open and cached explicit repair; no new install-offline guarantee after cache loss | Original scenario; scope not expanded |

## Dedup and mechanism inventory

Scanned backlog titles/code refs, epic maps/links, traps and ADR Declined concepts
for warm reopen, trusted install, flushMirror, redundant writes, handles and
preload. No existing no-COI warm-open outcome covers issue #319. Existing owners:

- `vfs/opfs-preload-failure-empty-bytes`: exact read-honesty overlap; I3 links it instead of minting another item.
- `vfs/mirror-existence-guards-cannot-heal-ledgered-dirs`: dirty directory retry obligation relevant to I4; existence is insufficient proof.
- `vfs/opfs-lazy-content-preload`: content loading, not handle acquisition. No lazy-sync-read promise added.
- `playground/install-stamp-invalidation`: older corruption question; current ADR-0307 and user answer govern this SDK outcome, not its historical options.
- `vfs/opfs-sync-cross-realm-mirror-coherence`: own-worker clean flush is not cross-realm coherence. Goal makes no new arbitrary multi-owner guarantee.
- `vfs/trusted-state-primitive`: gated generic extraction; no framework prescribed.
- PR #316's namespace and archive byte dedup own different effects; their paths/ownership must not be copied into competing mechanisms.

Existing authorities: OpfsDrainScheduler + persistence ledger/fence; Workbench
install-stamp authority + package-acquisition owner; generic shadow runtime
bindings; no-COI Worker admission; SDK same-page activation snapshot/restart.
FIT/PICKUP must select a layer-correct owner, not add a second trust ledger by
analogy. No coordination mechanism is introduced by this write-up.

## Executed baseline — real browser, no product substitutes

Checkout da485021fab3f9f881ebafe29106b604f347b2b3, Node v24.16.0,
pnpm 11.5.2, Playwright 1.60.0, Chromium 148.0.7778.96, Vite dev server 5.4.21.
Real public SDK, Worker, npm-client, nanoid 3.3.18 tarball and OPFS. Native
methods are counted by forwarding wrappers; only the quota case substitutes a
physically possible native createWritable rejection. Navigation response headers
are removed to establish actual no-COI, reported false by the browser.

Commands: `pnpm install --frozen-lockfile`, then `node .cache/issue319/probe.mjs`.
Dependency install and localhost/browser execution required sandbox escalation.
Earlier runner setup attempts failed before observations (missing dependencies,
Vite CJS import shape, localhost bind EPERM); the completed run below exited 0.

```json
{
  "head": "da485021fab3f9f881ebafe29106b604f347b2b3",
  "node": "v24.16.0",
  "chromium": "148.0.7778.96",
  "vite": "5.4.21",
  "package": "nanoid@3.3.18",
  "coi": false,
  "cold": {
    "writable": 29,
    "directory": 126,
    "fileHandle": 29,
    "getFile": 0,
    "root": 0,
    "failures": 0
  },
  "reboot": {
    "writable": 0,
    "directory": 98,
    "fileHandle": 29,
    "getFile": 58,
    "root": 2,
    "failures": 0
  },
  "warm": {
    "writable": 26,
    "directory": 117,
    "fileHandle": 26,
    "getFile": 0,
    "root": 0,
    "failures": 0,
    "registryRequests": 0
  },
  "quota": {
    "outcome": "resolved",
    "total": 1,
    "failures": [
      {
        "path": "/quota/package-lock.json",
        "op": "write",
        "message": "issue319 native write injection"
      }
    ]
  }
}
```

Counts cover the whole operation, including launcher/cache/metadata writes; they
are not a claim that all 26 writes are payload duplicates. Source inspection
locates unconditional package-file writes in npm-client/linker.ts; OpfsVfs
per-call path walks and separate root initialization explain the lookup
candidates. `flushMirror()` casts away the real PersistFailureReport and ignores
its total. The nanoid run isolates those defects, not adapter readiness or
Vite-build parity. No optimized implementation was tested.

## Reproduction

Use a disposable checkout with dependencies installed; Vite regenerates
`apps/playground/public/sw.js`. The following writes only disposable probe
files, starts a local server, creates an isolated browser context and closes it.
The project fixture/replay cache live in that temporary browser profile.

```sh
mkdir -p .cache/issue319
cat > .cache/issue319/worker.ts <<'WORKER'
import { syncMirror } from '../../packages/vfs/src/index.ts';
let counts = { writable: 0, directory: 0, fileHandle: 0, getFile: 0, root: 0 };
let fault = false;
for (const [proto, method, counter] of [
  [FileSystemFileHandle.prototype, 'createWritable', 'writable'],
  [FileSystemFileHandle.prototype, 'getFile', 'getFile'],
  [FileSystemDirectoryHandle.prototype, 'getDirectoryHandle', 'directory'],
  [FileSystemDirectoryHandle.prototype, 'getFileHandle', 'fileHandle'],
  [StorageManager.prototype, 'getDirectory', 'root'],
] as const) {
  const original = Reflect.get(proto, method);
  Reflect.set(proto, method, function (...args: unknown[]) {
    counts[counter]++;
    if (fault && method === 'createWritable' && this.name === 'package-lock.json') {
      return Promise.reject(new DOMException('issue319 native write injection', 'QuotaExceededError'));
    }
    return Reflect.apply(original, this, args);
  });
}
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'issue319-probe') return;
  void (async () => {
    const before = { ...counts };
    if (event.data.reset) counts = { writable: 0, directory: 0, fileHandle: 0, getFile: 0, root: 0 };
    fault = event.data.fault ?? fault;
    const fs = syncMirror() as ReturnType<typeof syncMirror> & { flush(): Promise<{ total: number; failures: unknown[] }> };
    const report = await fs.flush();
    self.postMessage({ type: 'issue319-report', counts: before, report: { total: report.total, failures: report.failures } });
  })();
});
await import('../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
WORKER
cat > .cache/issue319/probe.mjs <<'PROBE'
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/playground/package.json', import.meta.url));
const { createServer } = require('vite');
const root = process.cwd();
const server = await createServer({ configFile: `${root}/apps/playground/vite.config.ts`, root: `${root}/apps/playground`, server: { port: 5491, host: '127.0.0.1' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  console.log(JSON.stringify({ node: process.version, chromium: browser.version(), vite: require('vite/package.json').version }));
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => { if (request.url().includes('/npm-registry')) requests.push(request.url()); });
  await page.route('**/unit-harness.html*', async route => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['cross-origin-opener-policy'];
    delete headers['cross-origin-embedder-policy'];
    await route.fulfill({ response, headers });
  });
  await page.goto('http://127.0.0.1:5491/unit-harness.html');
  await page.evaluate(async ({ root }) => {
    const OriginalWorker = globalThis.Worker;
    globalThis.Worker = new Proxy(OriginalWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      globalThis.probeWorker = worker;
      return worker;
    } });
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    globalThis.bootProbe = async () => {
      globalThis.sandbox = await createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true, toolchain: { workerUrl: `/@fs${root}/.cache/issue319/worker.ts` } });
      while (!sandbox.runtime.isReady()) await new Promise(resolve => setTimeout(resolve, 10));
    };
    globalThis.inspectProbe = (options = {}) => new Promise((resolve) => {
      const listener = event => {
        if (event.data?.type !== 'issue319-report') return;
        probeWorker.removeEventListener('message', listener);
        resolve(event.data);
      };
      probeWorker.addEventListener('message', listener);
      probeWorker.postMessage({ type: 'issue319-probe', ...options });
    });
    await bootProbe();
  }, { root });
  console.log('boot', JSON.stringify(await page.evaluate(() => inspectProbe({reset: true}))));
  console.log('cold', JSON.stringify(await page.evaluate(async () => {
    await sandbox.fs.writeFile('/project/package.json', JSON.stringify({name: 'issue319-probe',version: '1.0.0',dependencies:{nanoid:'3.3.18'}}));
    await sandbox.toolchain.install({cwd:'/project',registryUrl:'/npm-registry'});
    return {coi:crossOriginIsolated, ...(await inspectProbe({reset:true}))};
  })));
  await page.evaluate(async () => { sandbox.dispose(); await bootProbe(); });
  console.log('reboot', JSON.stringify(await page.evaluate(() => inspectProbe({reset:true}))));
  const before = requests.length;
  console.log('warm', JSON.stringify(await page.evaluate(async () => {
    await sandbox.toolchain.install({cwd:'/project',registryUrl:'/npm-registry'});
    return inspectProbe({reset:true});
  })));
  console.log('warmRegistryRequests', requests.length - before);
  console.log('quota', JSON.stringify(await page.evaluate(async () => {
    await sandbox.fs.writeFile('/quota/package.json','{"name":"quota-probe","version":"1.0.0"}');
    await inspectProbe({reset:true,fault:true});
    let outcome='resolved';
    try { await sandbox.toolchain.install({cwd:'/quota',registryUrl:'/npm-registry'}); }
    catch(error) { outcome = {name:error.name,message:error.message}; }
    return {outcome,...(await inspectProbe({fault:false}))};
  })));
  await page.evaluate(() => sandbox.dispose());
} finally { await browser?.close(); await server.close(); }
PROBE
node .cache/issue319/probe.mjs
```

## Early challenge and resolution

Fresh read-only critic `/root/issue319_critic`, before the repeated-round answer:

> challenge: 2026-09-08 — 1 problem
>
> Ценность подтверждена исходным issue: повторный explicit `toolchain.install()` переписывает зависимости ради активации свежего Worker; ошибка flush маскируется. Измерения относятся к опубликованной 0.6.0, не доказывают времена текущего main.
>
> Возражение по более дешёвому пути: отдельный durable receipt и обход replay пока не обоснованы. По issue проверка одинаковых файлов и существующих директорий уже снижает post-boot open до ~1.04 s; собственно installer занимает 443 ms. Сначала проверить, достигает ли тот же `toolchain.install()` требуемого reopen через install-scoped dedup, прежние lock/integrity/repair проверки и активацию. Новый механизм доверия допустим только при доказанном недостающем результате.
>
> Старый Workbench stamp не подтверждает целостность дерева: `install-stamp.ts` прямо доверяет ему целиком. ADR-0307 дополнительно закрепляет отсутствие проверки байтов между install и сохранение изменений от guest/tools. Копирование stamp не закрывает повреждение одинаковой длины.
>
> При сохранении explicit `toolchain.install()` обязательных новых пользовательских развилок не найдено: требуемые repair, проверка manifest/lock, generic package scope и честные persistence failures заданы issue и действующими контрактами. Если вводится самостоятельный warm-open без install, возникает материальный вопрос: после намеренной правки зависимости reopen сохраняет её как обычный запуск или восстанавливает исходные байты как нынешний install? Повреждение и намеренная правка неразличимы побайтно; issue не определяет семантику этого нового действия.
>
> Offline reopen при утраченном replay cache — отдельное расширение: исходный сценарий сохраняет cache. Crash-proof durability также не следует из issue и противоречит текущему tier `works` ADR-0377. Не использовать эти дополнительные обещания как аргумент против дешёвого пути.

Resolution: final user answer requires preserving dependency edits. A cheaper
always-install path cannot meet that result. A fresh critique with that answer
and PR #316 sources is recorded verbatim in the goal; it does not prescribe a
receipt or generic trust framework. Final written-result review is separate.

## Write-up verification

- `pnpm backlog:check`: passed, zero invalid records.
- Initial `pnpm pr:check`: five environment/setup failures (four tsx IPC EPERM, one missing build outputs); no product-test failure.
- `pnpm build:libs`: passed. Repeated `pnpm pr:check` with local IPC permitted: docs-only 20/20 passed; typecheck/build:libs/check:arch/test:run/test:parity skipped by diff classification.
- Fresh reviewer `/root/warm_reopen_final` checked the complete final draft set against the raw request, definitive answer and PR #316 sources: [Final+GREEN PASS](issue319-refine-final-green.json), reviewed bb749252fe55528160fbf45bc0f5fea51b5b708d. No material scope fork found. Goal implementation remains unproven.

## FIT completion

User asked: «По процессам оформелние эпика заканчивается на draft? Все user fork разрешены?»
`docs/process/stages/fit.md` steps 5/8/9 require a seeded route, fresh final
written-result check and ready goal; child contracts stay draft. Refine had
closed the identified user frontier, but had stopped before that FIT completion.
The remaining three map questions are technical choices, not user-scope blockers.

Current-main check:

```text
gh api repos/vanilla-wave/rifty/commits/main --jq .sha
9a6331194f4b67245c2ab118a72f93920da584c5
gh api repos/vanilla-wave/rifty/compare/da485021fab3f9f881ebafe29106b604f347b2b3...9a6331194f4b67245c2ab118a72f93920da584c5
ahead_by: 2
Share manual inline review skill with Claude (#320)
Fix Express command exit after server close (#318)
```

The returned file list changes review tooling and Express drain/lifecycle
ownership. It contains no no-COI toolchain public API/worker install changes,
installer/linker, OpfsVfs or OpfsFsSync changes. Thus I1/I2's missing warm-open
entry, I3's ignored flush report, I4's unconditional linking and I5's repeated
OPFS lookup remain absent on this main. No new runtime run/timing is implied.
The independent flush-result repair can be seeded without resolving the new
activation authority or handle ownership; its draft leaves RED to PICKUP.
