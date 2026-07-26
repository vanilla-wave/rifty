#!/usr/bin/env node
import { realpathSync } from 'node:fs';
// Reduce applicable CI job results into the one `CI gate` verdict (ADR-0323 §4).
// Heavy jobs carry `!cancelled() && code != 'false'` conditions, so when
// change-scope dies they fail open and run; the gate still names the dead
// dependency instead of miscalling its empty output an invalid classification.
import { fileURLToPath } from 'node:url';

export function evaluateGate({ code, changeScope, lint, unit, e2e, browserUnit }) {
  const errors = [];
  const require = (name, actual, expected) => {
    if (actual !== expected) errors.push(`${name} concluded '${actual}'; expected '${expected}'`);
  };
  require('lint-and-typecheck', lint, 'success');

  let heavyExpected = 'success';
  if (code === 'true') {
    require('change-scope', changeScope, 'success');
  } else if (code === 'false') {
    require('change-scope', changeScope, 'success');
    heavyExpected = 'skipped';
  } else if (changeScope === 'success') {
    errors.push(`change-scope emitted invalid code='${code}'`);
  } else {
    errors.push(
      `change-scope concluded '${changeScope}' before classifying; heavy suite fails open — rerun it for a green gate`,
    );
  }

  require('unit-and-conformance', unit, heavyExpected);
  require('e2e-chromium', e2e, heavyExpected);
  require('browser-unit-chromium', browserUnit, heavyExpected);
  return errors;
}

function main() {
  const errors = evaluateGate({
    code: process.env.CODE ?? '',
    changeScope: process.env.CHANGE_SCOPE_RESULT ?? '',
    lint: process.env.LINT_RESULT ?? '',
    unit: process.env.UNIT_RESULT ?? '',
    e2e: process.env.E2E_RESULT ?? '',
    browserUnit: process.env.BROWSER_UNIT_RESULT ?? '',
  });
  for (const error of errors) process.stdout.write(`::error::${error}\n`);
  if (errors.length > 0) process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
