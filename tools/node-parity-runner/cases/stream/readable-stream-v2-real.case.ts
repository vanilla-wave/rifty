import { npmTreeFiles } from '../../src/npm-tree-files.ts';
import type { ParityCase } from '../../src/types.ts';
import { FIXTURE, readableStreamProgram } from './readable-stream-real.ts';

/** Original readable-stream 2.3.8 + through2 2.0.5 (unzipper 0.10 / exceljs line). */
const c: ParityCase = {
  setup: { files: npmTreeFiles(FIXTURE, 'v2') },
  code: readableStreamProgram({
    transform: `require('through2')(function (chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); })`,
    pipeline: false,
  }),
  expected:
    '["data:a","addListener:a","data:b","addListener:b","addListener:c","end listeners:1","pipe:XY"]\n',
};

export default c;
