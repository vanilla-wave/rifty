import { npmTreeFiles } from '../../src/npm-tree-files.ts';
import type { ParityCase } from '../../src/types.ts';
import { FIXTURE, readableStreamProgram } from './readable-stream-real.ts';

/** Original readable-stream 4.7.0 (own `events`/`buffer`/`process` npm deps). */
const c: ParityCase = {
  setup: { files: npmTreeFiles(FIXTURE, 'v4') },
  code: readableStreamProgram({
    transform:
      'new rs.Transform({ transform(chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); } })',
    pipeline: true,
  }),
  expected:
    '["data:a","addListener:a","data:b","addListener:b","addListener:c","end listeners:1","pipe:XY","pipeline:pq"]\n',
};

export default c;
