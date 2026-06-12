#!/usr/bin/env node

const baseUrl = process.argv[2];
if (baseUrl === undefined || baseUrl.length === 0) {
  console.error('Usage: smoke-npm-registry.mjs <base-url>');
  process.exit(2);
}

const smokeUrl = new URL('/npm-registry/vite', baseUrl);
let lastError = new Error('smoke did not run');

for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    const response = await fetch(smokeUrl, {
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
    }

    if (!contentType.includes('application/json')) {
      throw new Error(`expected JSON response, got ${contentType}: ${text.slice(0, 300)}`);
    }

    const data = JSON.parse(text);
    if (data.name !== 'vite') {
      throw new Error(`expected npm metadata for vite, got ${text.slice(0, 300)}`);
    }

    console.log(`Netlify npm registry smoke ok: ${smokeUrl}`);
    process.exit(0);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    if (attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

console.error(`Netlify npm registry smoke failed: ${lastError.message}`);
process.exit(1);
