/**
 * Goal isolate-guest-embed I2: `runCode` runs the export's guest bundle — the
 * file its child loads is byte-identical to `@riftydev/isolate-guest/guest.js`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/** RED until the export lands (map item 1): then `it`. */
const carrier = it.fails;

carrier("the host's guest bundle is the export's, byte for byte", () => {
  const exported = createRequire(import.meta.url).resolve('@riftydev/isolate-guest/guest.js');
  const hosted = fileURLToPath(new URL('../dist/guest.js', import.meta.url));
  expect(readFileSync(hosted).equals(readFileSync(exported))).toBe(true);
});
