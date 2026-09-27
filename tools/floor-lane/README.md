# Browser floor proof

Manual only; real SDK, npm tarballs, Vite 7.3.6, OPFS, reload and exact saved-byte readback.
Not a release or PR gate. ADR-0469. Results are observations, not a support promise.

Start the headerless host: `pnpm --filter @riftydev/playground dev:no-coi`.
Open `http://localhost:5411/browser-support.html`, press **Run persistent sandbox**,
then **Copy report**. A unique namespace isolates each run; no existing data is removed.
The page reloads itself after an acknowledged durable flush, reopens the same namespace,
compares source and built HTML, activates installed dependencies and builds again.
`checkSandboxSupport` uses the same emitted support probes as the published package.

For iOS: forward this server through your existing HTTPS development tunnel; open
`https://<your-tunnel>/browser-support.html` on the device. The tunnel must proxy all
paths (including `/@fs`, `/npm-registry` and workers), preserve MIME types, and add no
COOP/COEP headers. A LAN `http://` URL is not a secure context. No deployment is required.
Use Safari 26 macOS, Safari iOS and Yandex separately; copy each complete JSON, noting
OS, device, browser version, private/Lockdown mode and any OS memory observation.

After seven days, reopen the **same origin/profile** and press **Check previous saved run**.
A lost origin-local record cannot distinguish eviction from manually cleared data:
report that limitation. The first run records storage quota/usage; portable total memory
and eviction remain unknown. JS heap size is not process memory. A killed tab has no
success report: record the last visible step and OS observation separately.

Automated floor:

```sh
node tools/floor-lane/run.mjs --engine chromium --output /tmp/chrome-floor.json
node tools/floor-lane/run.mjs --engine firefox --output /tmp/firefox-floor.json
node tools/floor-lane/run.mjs --engine webkit --output /tmp/webkit-floor.json
```

Each default run installs one pinned runner in temporary storage with its own browser
cache, avoiding protocol mixing and Playwright cache GC between versions. Runner pins:
1.28.1 → Chromium 108.0.5359.29; 1.34.3 → **Firefox Beta 114.0b3** (its stable build is 113);
1.55.1 → WebKit 26.0. Sources: each upstream release's `packages/playwright-core/browsers.json`.
The beta run must never be labelled stable Firefox 114 or a stable-version certification.
OS-specific WebKit fallback builds are rejected by the observed-version check.

`--current` uses the workspace runner; `--runner /absolute/path/to/playwright` reuses
an already installed pinned runner; `--executable-path /path/to/browser` measures a
local Chromium-compatible browser (e.g. Yandex), recording its actual version, never
claiming it as the pinned floor. `--url` targets an existing host.

The manual-dispatch `browser-floor.yml` runs the three pins and retains JSON + host log.
`pass` = every step executed; `fail` names the actual failed product step; `unknown` =
install/launch/navigation failure or incomplete run (reason and page errors retained).
Copy the dated results into `docs/public/compat/browsers.md`; no automatic widening.
