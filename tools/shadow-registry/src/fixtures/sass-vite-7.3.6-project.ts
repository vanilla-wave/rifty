export const SASS_VITE_NODE_ORACLE_ENVIRONMENT = Object.freeze({
  node: 'v24.16.0',
  npm: '11.17.0',
  platform: 'darwin',
  architecture: 'arm64',
  vite: '7.3.6',
  sassEmbedded: '1.100.0',
});

export const SASS_VITE_PROJECT_FILES = Object.freeze({
  'package.json':
    '{"dependencies":{"sass-embedded":"1.100.0","vite":"7.3.6"},"name":"sass-vite-contract","private":true,"type":"module"}\n',
  'index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>\n',
  'src/main.js':
    "import './style.scss';\ndocument.getElementById('app').innerHTML = '<div class=\"card\"><span class=\"label\">sass-ready</span></div>';\n",
  'src/style.scss': `@use '@styles/palette';
@use './styles/nested';
@use 'virtual:spacing' as spacing;

@warn "rifty-sass-warning";

.card {
  color: palette.$accent;
  padding: spacing.$space;
  @include nested.label;
}
`,
  'src/styles/_palette.scss': '$accent: rgb(32, 64, 128);\n',
  'src/styles/_nested.scss': '@mixin label { .label { font-weight: 700; } }\n',
  'vite.config.js': `import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
    },
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        importers: [{
          canonicalize(url) {
            return url === 'virtual:spacing' ? new URL('virtual:spacing') : null;
          },
          load(url) {
            if (url.protocol !== 'virtual:') return null;
            return {contents: '$space: 11px;', syntax: 'scss'};
          },
        }],
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
`,
});

export const SASS_VITE_BUILD_PALETTE_EDIT = Object.freeze({
  path: 'src/styles/_palette.scss' as const,
  from: SASS_VITE_PROJECT_FILES['src/styles/_palette.scss'],
  to: '$accent: rgb(9, 87, 65);\n',
});

export const SASS_VITE_OFFLINE_HMR_PALETTE = '$accent: rgb(71, 22, 99);\n';
