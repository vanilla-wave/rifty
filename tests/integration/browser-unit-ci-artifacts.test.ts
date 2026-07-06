import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BROWSER_UNIT_CONFIG = 'playwright.browser-unit.config.ts';
const CI_WORKFLOW = '.github/workflows/ci.yml';

describe('browser-unit CI artifacts', () => {
  it('writes the browser-unit HTML report under the CI-uploaded playwright-report path', () => {
    const config = readFileSync(BROWSER_UNIT_CONFIG, 'utf8');
    const workflow = readFileSync(CI_WORKFLOW, 'utf8');

    // Config writes the HTML report into the browser-unit subfolder of playwright-report.
    expect(config).toContain("['html'");
    expect(config).toContain("outputFolder: 'playwright-report/browser-unit'");

    // The browser-unit JOB itself must upload that tree — a bare `path: playwright-report`
    // check passes on the unrelated e2e lane's upload, so pin it to the browser-unit job.
    const jobStart = workflow.indexOf('browser-unit-chromium:');
    expect(jobStart).toBeGreaterThanOrEqual(0);
    const browserUnitJob = workflow.slice(jobStart);
    const uploadStart = browserUnitJob.indexOf('name: playwright-report-browser-unit');
    expect(uploadStart).toBeGreaterThanOrEqual(0);
    expect(browserUnitJob.slice(uploadStart)).toContain('path: playwright-report');
  });
});
