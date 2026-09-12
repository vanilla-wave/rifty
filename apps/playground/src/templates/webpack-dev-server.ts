import { MONO_FONT_STACK } from '../glue/fonts.ts';
import type { NpmDevServerProjectSpec } from './project-spec.ts';

export const WEBPACK_ENTRY_SOURCE = `import './styles.css';

let renderCount = 0;

export function render() {
  renderCount += 1;
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');

  app.innerHTML =
    '<main class="app-shell">' +
    '<p class="eyebrow">webpack-dev-server</p>' +
    '<h1>Create App style project</h1>' +
    '<p class="lede">This page is bundled by webpack, served by webpack-dev-server, and refreshed through its stock HMR client.</p>' +
    '<button id="count" type="button">render #' + renderCount + '</button>' +
    '</main>';

  document.getElementById('count')?.addEventListener('click', () => {
    render();
  });
}

render();

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
`;

function webpackDevServerAllowedHost(): string {
  if (typeof globalThis.location === 'undefined') return 'localhost';
  const { hostname } = globalThis.location;
  if (hostname.length === 0) {
    throw new TypeError('webpack-dev-server template requires a browser location hostname');
  }
  return hostname;
}

const WEBPACK_ALLOWED_HOST = webpackDevServerAllowedHost();

const WEBPACK_CONFIG = `const path = require('node:path');

const port = Number(process.env.PORT ?? 5184);

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  devtool: 'eval-source-map',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto'
  },
  module: {
    rules: [
      {
        test: /\\.css$/i,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  devServer: {
    port,
    allowedHosts: [${JSON.stringify(WEBPACK_ALLOWED_HOST)}],
    hot: true,
    static: {
      directory: path.resolve(__dirname, 'public'),
      watch: true
    }
  }
};
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rifty + webpack-dev-server</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="main.js"></script>
  </body>
</html>
`;

const STYLES_CSS = `body {
  margin: 0;
  background: #101218;
  color: #f2f3f5;
  font-family: ${MONO_FONT_STACK};
}

.app-shell {
  display: grid;
  gap: 14px;
  max-width: 680px;
  padding: 34px;
}

.eyebrow {
  color: #8fe3c0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  margin: 0;
  text-transform: uppercase;
}

h1 {
  font-size: 32px;
  line-height: 38px;
  margin: 0;
}

.lede {
  color: rgba(242, 243, 245, 0.68);
  font-size: 15px;
  line-height: 23px;
  margin: 0;
  max-width: 560px;
}

button {
  justify-self: start;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: #efff7a;
  color: #17191f;
  cursor: pointer;
  font: 700 13px/18px inherit;
  padding: 9px 12px;
}
`;

const README = `# webpack-dev-server

This is an ordinary webpack project:

- \`npm install\` installs webpack, webpack-cli, webpack-dev-server, and CSS loaders.
- \`npm run dev\` runs the ordinary \`webpack serve\` package script.
- \`webpack.config.js\` is an ordinary CommonJS webpack config.
- The visible dev-server config trusts only the Playground page's exact hostname.

Edit \`src/index.js\` or \`src/styles.css\` and the preview updates through webpack-dev-server's stock HMR client.

This starter proves the listed webpack 5 / webpack-dev-server 5 / CSS-loader configuration plus rifty's documented generic process, HTTP, and WebSocket seams. It is not a blanket claim for arbitrary loaders, plugins, or other dev servers; a tool that reaches an unsupported Node API must fail loudly.
`;

export const WEBPACK_DEV_SERVER_TEMPLATE: NpmDevServerProjectSpec = {
  id: 'webpack-dev-server',
  displayName: 'Webpack dev server',
  runtime: 'npm-dev-server',
  install: {},
  packageType: false,
  devDependencies: {
    'css-loader': '^7.0.0',
    'style-loader': '^4.0.0',
    webpack: '^5.0.0',
    'webpack-cli': '^5.0.0',
    'webpack-dev-server': '^5.0.0',
  },
  entry: { relativePath: '/src/index.js', content: WEBPACK_ENTRY_SOURCE },
  defaultPort: 5184,
  estimatedBootSeconds: 45,
  devCommand: 'webpack serve',
  extraFiles: {
    '/webpack.config.js': WEBPACK_CONFIG,
    '/public/index.html': INDEX_HTML,
    '/src/styles.css': STYLES_CSS,
    '/README.md': README,
  },
};
