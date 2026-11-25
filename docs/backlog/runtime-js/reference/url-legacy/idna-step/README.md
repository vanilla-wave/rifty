# `toASCII` step: tr46, Chromium `URL`, ada (2026-11-24)

Question (manager): can the host's `URL` give Node's `toASCII` (ada 3.4.4) on browser hosts? Chromium
148.0.7778.96 (Playwright), Node v24.16.0, Unicode 17.0.0 `IdnaTestV2.txt` sources + the 40 hosts of
`../idna.cjs`. `node-record.cjs` loads a copy of Node's `lib/url.js` whose `toASCII` records its
input and output (`--expose-internals`; the copy equals `url.parse` on 6 431/6 431); comparison is at
that step, outcome = value or `ERR_INVALID_URL` (empty or forbidden char). Results: `results.txt`.

```sh
S=docs/backlog/runtime-js/reference/url-legacy/idna-step   # scripts; data in scratch dirs
curl -o /tmp/d/IdnaTestV2.txt https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt
node $S/idna-corpus.cjs /tmp/d/IdnaTestV2.txt $S/../idna.cjs /tmp/d/corpus.json
node --expose-internals $S/node-record.cjs /tmp/node-src /tmp/d/corpus.json /tmp/d/node-rec.json
node $S/chromium-step.cjs . /tmp/d/node-rec.json /tmp/d/chromium.json        # bare URL
node $S/chromium-step2.cjs . /tmp/t /tmp/d/node-rec.json /tmp/d/chromium2.json  # + punycode round trip (tr46 dir for punycode)
node $S/compare-c.cjs /tmp/d/node-rec.json /tmp/d/chromium2.json /tmp/t
node $S/ada-size.cjs /tmp/node-src/deps/ada/ada.cpp /tmp/d/ada-tables.js
```

- Shipped form: `packages/runtime-js/src/builtins/url-legacy/to-ascii.ts` (ada's decoder, round trip
  over the result's `xn--` labels); same 307/1 rows in Chromium; acceptance test
  `tests/browser-unit/url-legacy-idna.spec.ts`.
- Not verified: Chromium < 148 (Unicode version), the ada port's real bundle size.
