import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(resolve('.cache/pr341'), 'csv-diagnostic-controls-'));
const rows: {
  level: number;
  variant: string;
  expected: boolean;
  actual: boolean;
  stderr: string;
}[] = [];
console.log(`CSV_DIAGNOSTIC_CONTROLS_ROOT ${root}`);
for (const level of [1, 2]) {
  const base = resolve(`tools/agent-bench/corpus/cases/linked-import-${level}`);
  const patch = JSON.parse(await readFile(join(base, 'reference.json'), 'utf8')) as Record<
    string,
    string
  >;
  const original = patch['src/workbook.mjs']!;
  const fields =
    'const error=new Error(message);error.line=quoteLine||line;error.column=quoteColumn||column;throw error;';
  assert.ok(original.includes(fields));
  const variants = [
    { name: 'fields', source: original, expected: true },
    {
      name: 'message-named',
      source: original.replace(
        fields,
        'throw new Error(`${message} at line ${quoteLine||line}, column ${quoteColumn||column}`);',
      ),
      expected: true,
    },
    {
      name: 'message-at-column',
      source: original.replace(
        fields,
        'throw new Error(`${message} at line ${quoteLine||line} at column ${quoteColumn||column}`);',
      ),
      expected: true,
    },
    {
      name: 'fractional-column',
      source: original.replace(
        fields,
        'throw new Error(`${message} at line ${quoteLine||line}, column ${(quoteColumn||column)+0.5}`);',
      ),
      expected: false,
    },
    {
      name: 'message-parentheses',
      source: original.replace(
        fields,
        'throw new Error(`${message} (${quoteLine||line}:${quoteColumn||column})`);',
      ),
      expected: true,
    },
    {
      name: 'message-colon',
      source: original.replace(
        fields,
        'throw new Error(`${message} at ${quoteLine||line}:${quoteColumn||column}`);',
      ),
      expected: true,
    },
    {
      name: 'wrong-position',
      source: original.replace(
        fields,
        'throw new Error(`${message} at line ${quoteLine||line}, column ${(quoteColumn||column)+1}`);',
      ),
      expected: false,
    },
    {
      name: 'missing-position',
      source: original.replace(fields, 'throw new Error(message);'),
      expected: false,
    },
    ...(level === 2
      ? [
          {
            name: 'undo-void',
            source: original.replace(
              'current=history.pop();return true;',
              'current=history.pop();return;',
            ),
            expected: true,
          },
          {
            name: 'undo-no-effect',
            source: original.replace('current=history.pop();return true;', 'return true;'),
            expected: false,
          },
        ]
      : []),
  ];
  for (const variant of variants) {
    const dir = join(root, `level${level}-${variant.name}`);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/workbook.mjs'), variant.source);
    await writeFile(join(dir, 'judge.mjs'), await readFile(join(base, 'judge.mjs')));
    const result = spawnSync(process.execPath, ['judge.mjs'], { cwd: dir, encoding: 'utf8' });
    rows.push({
      level,
      variant: variant.name,
      expected: variant.expected,
      actual: result.status === 0,
      stderr: result.stderr,
    });
    await writeFile(
      join(dir, 'result.json'),
      JSON.stringify(
        { status: result.status, stdout: result.stdout, stderr: result.stderr },
        null,
        2,
      ),
    );
  }
}
await writeFile(join(root, 'results.json'), JSON.stringify(rows, null, 2));
assert.ok(
  rows.every((row) => row.actual === row.expected),
  JSON.stringify(rows),
);
console.log(
  JSON.stringify({
    selected: rows.length,
    accepted: rows.filter((row) => row.actual).length,
    rejected: rows.filter((row) => !row.actual).length,
  }),
);
