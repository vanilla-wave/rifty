#!/usr/bin/env node
// Live smoke for the production npm-registry route (ADR-0528): the deployed
// playground origin must answer `/npm-registry/<pkg>` with registry JSON and
// `/npm-registry/<pkg>/-/<pkg>-<v>.tgz` with a gzip tarball — never the SPA
// shell (the ADR-0133 incident) and never a proxy error page. Same-origin
// route: no CORS/CORP assertions (Netlify applies no custom headers to
// proxied content; the browser needs none for a same-origin fetch).

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

    const latest = data['dist-tags']?.latest;
    if (typeof latest !== 'string' || latest.length === 0) {
      throw new Error(`expected dist-tags.latest in vite metadata, got ${text.slice(0, 300)}`);
    }

    const tarballUrl = new URL(`/npm-registry/vite/-/vite-${latest}.tgz`, baseUrl);
    const tarball = await fetch(tarballUrl);
    if (!tarball.ok) {
      throw new Error(`tarball ${tarball.status} ${tarball.statusText}: ${tarballUrl}`);
    }
    const bytes = new Uint8Array(await tarball.arrayBuffer());
    if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
      throw new Error(`expected gzip tarball from ${tarballUrl}`);
    }

    console.log(`npm registry proxy smoke ok: ${smokeUrl} + vite-${latest}.tgz`);
    process.exit(0);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    if (attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

console.error(`npm registry proxy smoke failed: ${lastError.message}`);
process.exit(1);
