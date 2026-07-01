/**
 * CLI report template — run-to-completion Node program.
 *
 * It exercises the run-to-completion lifecycle opposite of long-running dev servers:
 * install a real npm dependency, read project files, print to stdout, then let
 * the process exit normally with no preview port.
 */
import type { NodeCliProjectSpec } from './project-spec.ts';

export const CLI_REPORT_SOURCE = `// CLI report.
// - yaml comes from a real npm install
// - node:fs reads project files from the local project filesystem
// - the program reaches the end and exits with code 0
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const argv = process.argv.slice(2);
const configPath = join(root, 'data/packages.yml');
const config = parse(readFileSync(configPath, 'utf8'));
const packages = Array.isArray(config?.packages) ? config.packages : [];
const names = packages.map((pkg) => String(pkg.name));
const workspaceFiles = readdirSync(root).map((entry) => typeof entry === 'string' ? entry : entry.name);

console.log([
  '[cli] package report',
  '[cli] cwd=' + root,
  '[cli] argv=' + (argv.length ? argv.join(' ') : '(none)'),
  '[cli] packages=' + names.length + ' -> ' + names.join(', '),
  '[cli] workspace=' + workspaceFiles.join(', '),
  '[cli] done',
].join('\\n'));
`;

const PACKAGES_YML = `packages:
  - name: "api"
    role: service
  - name: "docs"
    role: content
  - name: "jobs"
    role: worker
`;

export const CLI_REPORT_README = `# CLI report

Runs \`src/cli.js\` once, prints a report, and exits.

- \`data/packages.yml\` is parsed with the real \`yaml\` npm package.
- The terminal should end with \`[cli] completed with exit code 0\`.
- No preview iframe is expected for this template.
`;

export const CLI_REPORT_TEMPLATE: NodeCliProjectSpec = {
  id: 'cli-report',
  displayName: 'CLI report',
  runtime: 'node-cli',
  install: { yaml: '^2.5.0' },
  entry: { relativePath: '/src/cli.js', content: CLI_REPORT_SOURCE },
  defaultPort: 0,
  estimatedBootSeconds: 8,
  extraFiles: {
    '/data/packages.yml': PACKAGES_YML,
    '/README.md': CLI_REPORT_README,
  },
};
