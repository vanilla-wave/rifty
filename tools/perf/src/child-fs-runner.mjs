import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, dirname, join } from 'node:path';

const DEFAULT_PORT = 5391;

export function parseChildFsArgs(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--runs', '--out', '--port'].includes(flag) || value === undefined) {
      throw new TypeError(`invalid child-fs benchmark argument ${JSON.stringify(flag)}`);
    }
    if (values.has(flag)) throw new TypeError(`duplicate child-fs benchmark argument ${flag}`);
    values.set(flag, value);
  }
  const runs = Number(values.get('--runs'));
  if (!Number.isInteger(runs) || runs <= 0) {
    throw new TypeError('--runs must be a positive integer');
  }
  const out = values.get('--out');
  if (typeof out !== 'string' || out.trim().length === 0) {
    throw new TypeError('--out must be a non-empty path');
  }
  const port = values.has('--port') ? Number(values.get('--port')) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('--port must be an integer from 1 through 65535');
  }
  return { runs, out, port, ownerLoad: 'idle' };
}

export async function admitChildFsRun(argv, actions) {
  const options = parseChildFsArgs(argv);
  await actions.assertPortFree(options.port);
  return actions.launch(options);
}

export function assertChildFsPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      action();
    };
    socket.setTimeout(2_000, () => finish(() => reject(new Error(`port ${port} probe timed out`))));
    socket.once('connect', () =>
      finish(() => reject(new Error(`port ${port} is already occupied`))),
    );
    socket.once('error', (error) => {
      if (error && error.code === 'ECONNREFUSED') {
        finish(resolve);
        return;
      }
      finish(() => reject(error));
    });
  });
}

const DEFAULT_IO = Object.freeze({
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path),
});

function cleanupTemp(io, temp, primary) {
  try {
    io.unlink(temp);
  } catch (cleanupError) {
    if (cleanupError && cleanupError.code === 'ENOENT') return;
    throw new AggregateError(
      [primary, cleanupError],
      'artifact publication and temp cleanup failed',
    );
  }
}

export function publishChildFsArtifact(path, json, io = DEFAULT_IO) {
  const parent = dirname(path);
  const temp = join(parent, `.${basename(path)}.tmp`);
  io.mkdir(parent);
  try {
    io.writeFile(temp, json);
    io.rename(temp, path);
  } catch (error) {
    cleanupTemp(io, temp, error);
    throw error;
  }
}
