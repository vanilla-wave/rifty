import type { ParityCase } from '../../src/types.ts';
export default {
  setup: { files: { 'parent/child.js': "process.stdout.write('sibling-ran'); process.exit(0);" } },
  cwd: '/project',
  code: `
    const { spawn } = require('node:child_process');
    const { resolve } = require('node:path');
    const realmPromise = Object.getPrototypeOf((async () => {})()).constructor;
    const realmPromisePrototype = realmPromise.prototype;
    const initialPromiseDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
    const snapshot = () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
      return {
        descriptorValueIdentity: descriptor?.value === realmPromise,
        descriptorUnchanged:
          descriptor?.value === initialPromiseDescriptor?.value &&
          descriptor?.writable === initialPromiseDescriptor?.writable &&
          descriptor?.enumerable === initialPromiseDescriptor?.enumerable &&
          descriptor?.configurable === initialPromiseDescriptor?.configurable,
        constructorIdentity: Promise === realmPromise,
        prototypeIdentity: Promise.prototype === realmPromisePrototype,
      };
    };
    const before = snapshot();
    process.argv[1] = resolve('../parent/main.js');
    const child = spawn('node', ['child.js'], { cwd: process.cwd() });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.once('close', () => {
      console.log(stdout === '' ? 'missing' : 'sibling-ran');
      console.log(JSON.stringify({ promiseRealm: { before, after: snapshot() } }));
    });
  `,
  expected:
    'missing\n' +
    '{"promiseRealm":{"before":{"descriptorValueIdentity":true,"descriptorUnchanged":true,' +
    '"constructorIdentity":true,"prototypeIdentity":true},"after":{' +
    '"descriptorValueIdentity":true,"descriptorUnchanged":true,' +
    '"constructorIdentity":true,"prototypeIdentity":true}}}\n',
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
} satisfies ParityCase;
