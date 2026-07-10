import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig, loadEnv } from 'vite';
import {
  requireAbsoluteHttpUrl,
  requireRepositoryUrl,
  requireSiteBaseUrl,
} from './src/configured-url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function discoveryAssets(siteUrl: string): { robots: string; sitemap: string } {
  return {
    robots: `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', siteUrl).href}\n`,
    sitemap: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${escapeXml(siteUrl)}</loc>\n  </url>\n</urlset>\n`,
  };
}

function landingDiscoveryPlugin(siteUrl: string, repositoryUrl: string): Plugin {
  const ogImageUrl = new URL('og-image.png', siteUrl).href;
  const { robots, sitemap } = discoveryAssets(siteUrl);
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'rifty',
    url: siteUrl,
    description: 'Open, self-hostable Node-compatible runtime and WASI runner for Chromium.',
    sameAs: [repositoryUrl],
  }).replaceAll('<', '\\u003c');

  return {
    name: 'rifty-landing-discovery',
    transformIndexHtml(html) {
      return html
        .replaceAll('__RIFTY_SITE_URL__', siteUrl)
        .replaceAll('__RIFTY_OG_IMAGE_URL__', ogImageUrl)
        .replaceAll('__RIFTY_REPOSITORY_URL__', repositoryUrl)
        .replace('__RIFTY_STRUCTURED_DATA__', structuredData);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const body =
          pathname === '/robots.txt' ? robots : pathname === '/sitemap.xml' ? sitemap : null;
        if (body === null) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader(
          'Content-Type',
          pathname === '/robots.txt'
            ? 'text/plain; charset=utf-8'
            : 'application/xml; charset=utf-8',
        );
        response.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

function landingPerformanceContractPlugin(): Plugin {
  return {
    name: 'rifty-landing-performance-contract',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const entry = chunks.find((chunk) => chunk.isEntry);
      const explorer = chunks.find(
        (chunk) =>
          chunk.name === 'explorer' || chunk.facadeModuleId?.endsWith('/src/explorer/explorer.ts'),
      );
      if (!entry || !explorer) {
        throw new Error('landing build must emit distinct entry and explorer chunks');
      }
      if (!entry.dynamicImports.includes(explorer.fileName)) {
        throw new Error('landing explorer must remain a dynamic import of the entry chunk');
      }
      if (entry.imports.includes(explorer.fileName)) {
        throw new Error('landing entry must not statically import the explorer chunk');
      }
    },
  };
}

// Static marketing site. No COOP/COEP: it is a separate origin from the
// playground and needs no SharedArrayBuffer.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, ROOT, ''), ...process.env };
  const siteUrl = requireSiteBaseUrl(env.VITE_RIFTY_SITE_URL);
  const repositoryUrl = requireRepositoryUrl(env.VITE_RIFTY_REPOSITORY_URL);
  requireAbsoluteHttpUrl(env.VITE_RIFTY_SDK_DOCS_URL, 'VITE_RIFTY_SDK_DOCS_URL');

  return {
    plugins: [landingDiscoveryPlugin(siteUrl, repositoryUrl), landingPerformanceContractPlugin()],
    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: true,
      modulePreload: { polyfill: false },
    },
  };
});
