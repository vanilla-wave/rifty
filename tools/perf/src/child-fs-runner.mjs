export {
  assertPerfPortFree as assertChildFsPortFree,
  publishPerfArtifact as publishChildFsArtifact,
} from './runner-io.mjs';

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
