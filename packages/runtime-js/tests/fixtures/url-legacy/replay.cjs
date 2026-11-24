// `run(input, output)`: replay a corpus through `url` / `querystring`, write one record per call.
// in: { kind: 'url' | 'querystring', calls: [{ fn, args }] } | { kind: 'hosts', hosts: [string] }
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { decode, record } = require(path.join(__dirname, 'codec.cjs'));

function replayCorpus(corpus) {
  const url = require('node:url');
  if (corpus.kind === 'hosts')
    return corpus.hosts.map((h) => record(() => url.parse(`http://${h}/`).hostname));
  const mod = corpus.kind === 'url' ? url : require('node:querystring');
  return corpus.calls.map((c) => record(() => mod[c.fn](...decode(c.args, url))));
}
function run(input, output) {
  fs.writeFileSync(
    output,
    JSON.stringify(replayCorpus(JSON.parse(fs.readFileSync(input, 'utf8')))),
  );
}
module.exports = { replayCorpus, run };
