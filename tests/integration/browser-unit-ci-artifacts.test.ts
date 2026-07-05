import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BROWSER_UNIT_CONFIG = 'playwright.browser-unit.config.ts';
const CI_WORKFLOW = '.github/workflows/ci.yml';

describe('browser-unit CI artifacts', () => {
  it('writes the browser-unit HTML report under the CI-uploaded playwright-report path', () => {
    const config = readFileSync(BROWSER_UNIT_CONFIG, 'utf8');
    const workflow = readFileSync(CI_WORKFLOW, 'utf8');

    expect(config).toContain("['html'");
    expect(config).toContain("outputFolder: 'playwright-report/browser-unit'");
    expect(workflow).toContain('path: playwright-report');
  });
});
