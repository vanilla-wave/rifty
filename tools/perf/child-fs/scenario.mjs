const DEPENDENCIES = Object.freeze({
  '@gravity-ui/icons': '2.22.0',
  '@gravity-ui/uikit': '7.48.1',
  'date-fns': '4.4.0',
  express: '4.21.2',
  react: '19.2.8',
  'react-dom': '19.2.8',
  vite: '7.3.6',
});

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: 'rifty-child-fs-benchmark',
    private: true,
    version: '0.0.0',
    type: 'module',
    dependencies: DEPENDENCIES,
  },
  null,
  2,
)}\n`;

const FILES = Object.freeze({
  '/package.json': PACKAGE_JSON,
  '/index.html':
    '<!doctype html><div id="root"></div><script type="module" src="/src/main.jsx"></script>\n',
  '/vite.config.js':
    "export default { esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] }, build: { minify: false, sourcemap: false } };\n",
  '/src/main.jsx':
    "import { createRoot } from 'react-dom/client'; import { ThemeProvider } from '@gravity-ui/uikit'; import '@gravity-ui/uikit/styles/styles.css'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<ThemeProvider theme=\"light\"><App /></ThemeProvider>);\n",
  '/src/App.jsx':
    "import { Button, Card, Text } from '@gravity-ui/uikit'; import { Gear } from '@gravity-ui/icons'; import { format } from 'date-fns'; import { Panel } from './Panel.jsx'; export function App(){ return <Card view=\"outlined\"><Text variant=\"header-1\">agent-loop app</Text><Text>{format(new Date(0), 'yyyy-MM-dd')}</Text><Button view=\"action\"><Gear />act</Button><Panel /></Card>; }\n",
  '/src/Panel.jsx':
    'import { Label, Text } from \'@gravity-ui/uikit\'; export function Panel(){ return <div><Label theme="info">bench-seed</Label><Text variant="body-1">iteration bench-seed</Text></div>; }\n',
  '/express-anchor.cjs':
    "const marker=process.argv[2];const started=performance.now();const express=require('express');const app=express();const server=app.listen(4197,'127.0.0.1',()=>{const elapsed=performance.now()-started;console.log(`RIFTY_EXPRESS_READY ${marker} ${elapsed}`);server.close((error)=>{if(error)throw error;console.log(`RIFTY_EXPRESS_CLOSED ${marker}`);});});\n",
});

const SCENARIO = Object.freeze({
  id: 'child-fs-hot-path-v1',
  root: '/bench',
  dependencies: DEPENDENCIES,
  files: FILES,
});

const IDENTITY = Object.freeze({
  scenarioDigest: '559e5e226348c484d542f197b442d3826e11d9e19c206d028c978d96a4595d4c',
  dependencyDigest: 'de9e65b1ca98200f8be9b40080b3d5ac871c962786b33665d564b3da68d4b0bc',
});

export function childFsScenario() {
  return SCENARIO;
}

export function childFsScenarioIdentity() {
  return IDENTITY;
}
