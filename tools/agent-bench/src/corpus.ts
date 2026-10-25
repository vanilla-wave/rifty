import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { FileTree } from './files.ts';
import type { TaskJudge } from './judge/context.ts';
import { digest } from './plan.ts';
import type { Task } from './tasks.ts';
interface Card {
  id: string;
  group: 'bug' | 'feature' | 'app';
  family: string;
  split: 'calibration' | 'evaluation';
  project: string;
  prompt: string;
  judge: string;
  starterRegression?: { buildCommand: string; heading: string };
  inputsSha256: string;
  lockSha256: string;
  promptSha256: string;
  judgeSha256: string;
}
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.[^'"]+\.ts)['"]/g;

/** Every agent-bench `.ts` file a judge reaches through relative imports; criteria live in all of them. */
export async function judgeImportClosure(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of (await readFile(file, 'utf8')).matchAll(RELATIVE_IMPORT)) {
      const target = relative(process.cwd(), resolve(dirname(file), match[1]!));
      if (target.startsWith('tools/agent-bench/')) queue.push(target);
    }
  }
  seen.delete(entry);
  return [...seen].sort();
}

export function validateFiles(value: unknown): asserts value is FileTree {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Corpus files must be a text tree');
  const files = value as Record<string, unknown>;
  for (const [path, text] of Object.entries(files)) {
    if (
      typeof text !== 'string' ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      path.split('/').some((part) => ['node_modules', '.git', '.rifty', 'dist'].includes(part))
    )
      throw new Error(`Invalid corpus path/content: ${path}`);
    const parts = path.split('/');
    for (let n = 1; n < parts.length; n++)
      if (Object.hasOwn(files, parts.slice(0, n).join('/')))
        throw new Error(`Corpus file ancestor: ${path}`);
  }
}
export async function loadCorpus(
  suite: string,
  root = resolve('tools/agent-bench/corpus'),
): Promise<Task[]> {
  if (!/^[a-z0-9-]+$/.test(suite)) throw new Error('Invalid corpus version');
  const manifestText = await readFile(join(root, `${suite}.json`), 'utf8');
  const manifest = JSON.parse(manifestText) as {
    version: string;
    cases: Card[];
  };
  if (manifest.version !== suite || !Array.isArray(manifest.cases) || !manifest.cases.length)
    throw new Error('Invalid corpus manifest');
  const ids = new Set<string>();
  const families = new Map<string, string>();
  const tasks: Task[] = [];
  for (const card of manifest.cases) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(card.id) ||
      ids.has(card.id) ||
      !['bug', 'feature', 'app'].includes(card.group) ||
      !card.family ||
      !['calibration', 'evaluation'].includes(card.split) ||
      card.project !== 'project.json' ||
      card.prompt !== 'prompt.md' ||
      !/^judge\.(cjs|mjs|ts)$/.test(card.judge)
    )
      throw new Error('Invalid corpus card');
    if (
      card.starterRegression &&
      (card.group !== 'feature' ||
        card.starterRegression.buildCommand !== 'npm run build' ||
        typeof card.starterRegression.heading !== 'string' ||
        !card.starterRegression.heading)
    )
      throw new Error('Invalid starter regression');
    ids.add(card.id);
    if (families.has(card.family) && families.get(card.family) !== card.split)
      throw new Error(`Corpus family leaks across splits: ${card.family}`);
    families.set(card.family, card.split);
    const dir = join(root, 'cases', card.id);
    const project = await readFile(join(dir, card.project), 'utf8');
    const prompt = await readFile(join(dir, card.prompt), 'utf8');
    const judge = await readFile(join(dir, card.judge), 'utf8');
    const files: unknown = JSON.parse(project);
    validateFiles(files);
    if (Object.keys(files).some((path) => /(?:reference|partial|alternative|judge)/.test(path)))
      throw new Error(`Private corpus artifacts in seed: ${card.id}`);
    const lock = files['package-lock.json'];
    if (!lock || JSON.parse(lock).lockfileVersion !== 3) throw new Error('Corpus requires v3 lock');
    for (const [name, actual, expected] of [
      ['input', digest(project), card.inputsSha256],
      ['lock', digest(lock), card.lockSha256],
      ['prompt', digest(prompt), card.promptSha256],
      ['judge', digest(judge), card.judgeSha256],
    ])
      if (actual !== expected) throw new Error(`Corpus ${card.id} ${name} hash mismatch`);
    const cardText = await readFile(join(dir, 'card.json'), 'utf8');
    const stored = JSON.parse(cardText) as Card;
    const {
      inputsSha256: _inputs,
      lockSha256: _lock,
      promptSha256: _prompt,
      judgeSha256: _judge,
      ...metadata
    } = card;
    if (!isDeepStrictEqual(stored, metadata)) throw new Error(`Corpus card mismatch: ${card.id}`);
    const controls: Record<string, FileTree> = { baseline: {} };
    for (const variant of ['reference', 'partial', 'alternative']) {
      const patch: unknown = JSON.parse(await readFile(join(dir, `${variant}.json`), 'utf8'));
      validateFiles(patch);
      controls[variant] = patch;
    }
    const app = card.group === 'app';
    tasks.push({
      id: card.id,
      prompt,
      files,
      preset: 'project-files',
      port: 5174,
      node: false,
      group: card.group,
      family: card.family,
      split: card.split,
      corpus: suite,
      corpusManifestSha256: digest(manifestText),
      caseCardSha256: digest(cardText),
      controls,
      judgeFiles: await (async () => {
        const listed = [
          join(dir, card.judge),
          'tools/agent-bench/src/judge/context.ts',
          ...(card.starterRegression
            ? ['tools/agent-bench/src/runner.ts', 'tools/agent-bench/src/corpus.ts']
            : []),
        ];
        // Every file the judge reaches by import carries criteria (ADR-0506/0507); listed order is kept.
        const reached = await judgeImportClosure(join(dir, card.judge));
        return [...listed, ...reached.filter((file) => !listed.includes(file))];
      })(),
      ...(app
        ? {
            judge: (
              (await import(pathToFileURL(join(dir, card.judge)).href)) as { judge: TaskJudge }
            ).judge,
          }
        : {
            commandJudge: {
              path: `.bench-judge.${card.judge.split('.').at(-1)}`,
              text: judge,
              marker: `RIFTY_CORPUS_PASS:${card.id}`,
              ...(card.starterRegression ? { starterRegression: card.starterRegression } : {}),
            },
          }),
    });
  }
  return tasks;
}
