/**
 * Markdown SSG template — fs-heavy build plus static preview server.
 *
 * It reads a small content tree, renders markdown through a real npm package,
 * writes `/dist`, then serves the generated output through `node:http`.
 */
import { MONO_FONT_STACK } from '../glue/fonts.ts';
import type { NodeServerProjectSpec } from './project-spec.ts';

export const MARKDOWN_SSG_SOURCE = `// Markdown SSG.
// - marked comes from a real npm install
// - content/*.md is read from the VFS
// - dist/*.html is generated before the static server starts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { marked } from 'marked';

const root = process.cwd();
const contentDir = join(root, 'content');
const outDir = join(root, 'dist');

function walkMarkdown(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(full));
    else if (entry.isFile() && extname(entry.name) === '.md') files.push(full);
  }
  return files.sort();
}

function pageShell(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + title + '</title><link rel="stylesheet" href="/styles.css"></head><body><main>'
    + body + '</main></body></html>';
}

async function build() {
  mkdirSync(outDir, { recursive: true });
  let indexItems = '';
  for (const sourcePath of walkMarkdown(contentDir)) {
    const markdown = readFileSync(sourcePath, 'utf8');
    const title = (markdown.match(/^#\\s+(.+)$/m)?.[1] ?? basename(sourcePath, '.md')).trim();
    const body = await marked.parse(markdown);
    const slug = basename(sourcePath, '.md');
    const html = pageShell(title, body);
    writeFileSync(join(outDir, slug + '.html'), html);
    indexItems += '<li><a href="/' + slug + '.html">' + title + '</a></li>';
    console.log('[ssg] built ' + slug + '.html from ' + sourcePath.replace(root + '/', ''));
  }
  writeFileSync(join(outDir, 'index.html'), pageShell('Project docs', '<h1>Project docs</h1><ul>' + indexItems + '</ul>'));
  writeFileSync(join(outDir, 'styles.css'), 'body{margin:0;background:#111318;color:#e9edf2;font:15px/1.6 ${MONO_FONT_STACK}}main{max-width:720px;margin:0 auto;padding:38px 22px}a{color:#8bd3ff}code{color:#f6c768}pre{background:#181d25;border:1px solid #2a3140;border-radius:6px;padding:12px;overflow:auto}li{margin:8px 0}');
  console.log('[ssg] wrote dist/index.html');
}

function fileForUrl(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = normalize(requested).replace(/^\\.\\.(\\/|$)/, '');
  return join(outDir, normalized);
}

function contentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

await build();

const port = Number(process.env.PORT ?? 3333);
createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost:' + port);
  const file = fileForUrl(url.pathname);
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    console.log('[ssg] GET ' + url.pathname + ' -> ' + file.replace(root + '/', ''));
    res.writeHead(200, { 'content-type': contentType(file) });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(port, () => {
  console.log('markdown ssg listening on port ' + port);
});
`;

const INTRO_MD = `# Build inside the browser

This page was rendered from markdown by the build step.

- read \`content/*.md\`
- write \`dist/*.html\`
- serve the generated files through \`node:http\`
`;

const API_MD = `# Runtime notes

The generated site exercises filesystem-heavy project code:

\`\`\`js
writeFileSync(join(outDir, slug + '.html'), html)
\`\`\`

The preview then reads the generated output, not the source markdown.
`;

export const MARKDOWN_SSG_README = `# Markdown SSG

Builds markdown files from \`content/\` into \`dist/\`, then serves the generated
site on the preview port.
`;

export const MARKDOWN_SSG_TEMPLATE: NodeServerProjectSpec = {
  id: 'markdown-ssg',
  displayName: 'Markdown SSG',
  runtime: 'node-server',
  install: { marked: '^12.0.0' },
  entry: { relativePath: '/src/main.js', content: MARKDOWN_SSG_SOURCE },
  defaultPort: 3333,
  estimatedBootSeconds: 12,
  sqlite: false,
  extraFiles: {
    '/content/intro.md': INTRO_MD,
    '/content/runtime.md': API_MD,
    '/README.md': MARKDOWN_SSG_README,
  },
};
