// `node program.cjs <in.json> <out.json>` (replay.cjs): live Node is the oracle, a rifty guest the subject.
'use strict';
require(require('node:path').join(__dirname, 'replay.cjs')).run(process.argv[2], process.argv[3]);
