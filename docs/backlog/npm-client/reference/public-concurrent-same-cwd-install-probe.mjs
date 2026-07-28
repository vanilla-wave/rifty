import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../../../packages/npm-client/src/_test-fixtures/tar-builder.ts';
import { install } from '../../../../packages/npm-client/src/installer.ts';
import { RegistryClient } from '../../../../packages/npm-client/src/registry.ts';
import { MemoryVfs } from '../../../../packages/vfs/src/index.ts';

const encoder = new TextEncoder();

async function tarball(name) {
  const manifest = JSON.stringify({
    name,
    version: '1.0.0',
    bin: { shared: 'cli.js' },
  });
  const files = {
    'package.json': manifest,
    'cli.js': `console.log(${JSON.stringify(name)});\n`,
  };
  const chunks = [];
  for (const [path, body] of Object.entries(files)) {
    const bytes = encoder.encode(body);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return await gzip(concat(...chunks, TAR_TRAILER));
}

class FixtureRegistry extends RegistryClient {
  constructor(entries) {
    super({ baseUrl: '/fixture', fetch: async () => new Response('', { status: 599 }) });
    this.entries = entries;
  }

  async getPackument(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`missing ${name}`);
    return {
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name,
          version: '1.0.0',
          bin: { shared: 'cli.js' },
          dist: { tarball: `fixture://${name}/1.0.0` },
        },
      },
    };
  }

  async getTarball(url) {
    const name = new URL(url).hostname;
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`missing ${url}`);
    return entry;
  }
}

function gateFirstLockfileWrite(vfs) {
  let release;
  let markReached;
  let armed = true;
  const reached = new Promise((resolve) => {
    markReached = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const gated = new Proxy(vfs, {
    get(target, property) {
      if (property === 'writeFile') {
        return async (path, data) => {
          if (armed && path === '/project/package-lock.json') {
            armed = false;
            markReached();
            await released;
          }
          return await target.writeFile(path, data);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { gated, reached, release };
}

const vfs = new MemoryVfs();
await vfs.mkdir('/project', { recursive: true });
const registry = new FixtureRegistry(
  new Map([
    ['provider-a', await tarball('provider-a')],
    ['provider-z', await tarball('provider-z')],
  ]),
);
const lockGate = gateFirstLockfileWrite(vfs);
const z = install(
  'root',
  '1.0.0',
  { 'provider-z': '1.0.0' },
  { vfs: lockGate.gated, cwd: '/project', registry },
);
await lockGate.reached;
const aResult = await install(
  'root',
  '1.0.0',
  { 'provider-a': '1.0.0' },
  { vfs, cwd: '/project', registry },
);
lockGate.release();
const zResult = await z;

const lock = JSON.parse(await vfs.readFileText('/project/package-lock.json'));
const launcher = await vfs.readFileText('/project/node_modules/.bin/shared');
console.log(
  JSON.stringify(
    {
      bothSucceeded: [aResult.packages[0]?.name, zResult.packages[0]?.name].sort(),
      finalLockEntries: Object.keys(lock.packages).sort(),
      finalLauncher: launcher,
      providerAExists: await vfs.exists('/project/node_modules/provider-a/package.json'),
      providerZExists: await vfs.exists('/project/node_modules/provider-z/package.json'),
    },
    null,
    2,
  ),
);
