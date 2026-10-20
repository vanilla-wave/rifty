const fs = require('node:fs');
process.env.ESBUILD_WORKER_THREADS = process.argv[3] === 'exec' ? '0' : '1';
const esbuild = require(process.argv[2]);
const args = {
  buildSync: [{ stdin: { contents: 'const x = 1' }, write: false }],
  transformSync: ['const x = 1'],
  formatMessagesSync: [[{ text: 'diagnostic' }], { kind: 'warning' }],
  analyzeMetafileSync: [{ inputs: {}, outputs: {} }],
};
const result = {};
for (const name of Object.keys(esbuild).filter((name) => name.endsWith('Sync'))) {
  if (!(name in args)) throw new Error(`Missing Sync sample: ${name}`);
  try {
    esbuild[name](...args[name]);
    result[name] = { success: true };
  } catch (error) {
    result[name] = { name: error.name, feature: error.feature };
  }
}
esbuild.stop();
fs.writeFileSync('sync-result.json', JSON.stringify(result));
