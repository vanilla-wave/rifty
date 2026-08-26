import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, dirname, join } from 'node:path';

export function assertPerfPortFree(port) {
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

export function publishPerfArtifact(path, json, io = DEFAULT_IO) {
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
