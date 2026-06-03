// @riftydev/npm-client — the semver core behind `npm install`. Pure & synchronous.
// Run: `pnpm --filter @rifty-examples/standalone semver`.
import { compare, matchesRange, parse, pickBestVersion } from '@riftydev/npm-client';

console.log('parse 1.2.3       :', parse('1.2.3'));
console.log('compare 1.2 vs 1.10:', compare('1.2.0', '1.10.0')); // < 0 — 1.2.0 is older
console.log('1.4.2 in ^1.2.0   :', matchesRange('1.4.2', '^1.2.0')); // true
console.log('best of [1,1.4.2,2]:', pickBestVersion(['1.0.0', '1.4.2', '2.0.0'], '^1.2.0')); // 1.4.2
