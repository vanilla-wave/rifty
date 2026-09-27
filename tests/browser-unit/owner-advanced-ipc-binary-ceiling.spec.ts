import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

const binaryNames = ['Buffer', 'ArrayBuffer', 'SharedArrayBuffer', 'Uint16Array', 'DataView'];
const nestNames = ['root', 'record', 'Map key', 'Map value', 'Set', 'Error cause', 'cycle'];
const exercise = `
  function rejectedBinary(send) {
    const { Buffer } = require('node:buffer');
    const binaries = [
      ['Buffer', () => Buffer.from([1, 2])],
      ['ArrayBuffer', () => new ArrayBuffer(2)],
      ['SharedArrayBuffer', () => new SharedArrayBuffer(2)],
      ['Uint16Array', () => new Uint16Array([1, 2])],
      ['DataView', () => new DataView(new ArrayBuffer(2))],
    ];
    const nests = [
      ['root', value => value], ['record', value => ({ nested: [value] })],
      ['Map key', value => new Map([[value, 1]])],
      ['Map value', value => new Map([[1, value]])],
      ['Set', value => new Set([value])],
      ['Error cause', value => new Error('cause', { cause: value })],
      ['cycle', value => { const record = { value }; record.self = record; return record; }],
    ];
    const failures = [];
    let reads = 0;
    for (const [name, make] of binaries) for (const [nestName, nest] of nests) {
      try {
        send({ tag: 'binary', get value() { reads++; return nest(make()); } });
        failures.push([name, nestName, 'NO_THROW']);
      } catch (error) {
        failures.push([name, nestName, error.name, error.feature, error.message]);
      }
    }
    return { failures, reads };
  }
`;
const child = `
  ${exercise}
  const seen = [];
  process.on('message', message => {
    seen.push(message.sequence ?? message.tag);
    if (message.sequence === 2) process.send({ tag: 'done', seen, connected: process.connected });
  });
  process.send({ tag: 'control' });
  const result = rejectedBinary(value => process.send(value));
  process.send({ tag: 'ready', result });
  setInterval(() => {}, 1000);
`;
const parent = `
  ${exercise}
  const { fork } = require('node:child_process');
  const child = fork('binary-child.cjs', [], { serialization: 'advanced', stdio: 'pipe' });
  const result = { seen: [] };
  child.on('error', error => { console.error(error); process.exit(1); });
  child.on('message', message => {
    result.seen.push(message.tag);
    if (message.tag === 'ready') {
      result.child = message.result;
      child.send({ sequence: 1 });
      result.parent = rejectedBinary(value => child.send(value));
      result.connected = child.connected;
      child.send({ sequence: 2 });
    }
    if (message.tag === 'done') {
      result.childSeen = message.seen;
      result.childConnected = message.connected;
      child.once('exit', () => console.log('BINARY_RESULT:' + JSON.stringify(result)));
      child.kill('SIGUSR2');
    }
  });
`;

test('both advanced IPC senders reject binary graphs without dispatch and retain a usable channel', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'browser-unit-advanced-ipc-binary-ceiling',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    await writeOwnerFile(page, '/scratch/binary-child.cjs', child);
    await writeOwnerFile(page, '/scratch/binary-parent.cjs', parent);
    const actual = await execLine(page, 'node binary-parent.cjs');
    expect(actual.exit, actual.out).toBe(0);
    const output = stripVTControlCharacters(actual.out).replaceAll('\r', '');
    const line = output.split('\n').find((value) => value.startsWith('BINARY_RESULT:'));
    expect(line, output).toBeDefined();
    const feature = 'child_process.serialization.advanced.binary';
    const expected = {
      failures: binaryNames.flatMap((name) =>
        nestNames.map((nest) => [
          name,
          nest,
          'NotImplementedError',
          feature,
          `Not implemented: ${feature}`,
        ]),
      ),
      reads: binaryNames.length * nestNames.length,
    };
    expect(JSON.parse(line?.slice('BINARY_RESULT:'.length) ?? '{}')).toEqual({
      seen: ['control', 'ready', 'done'],
      parent: expected,
      child: expected,
      connected: true,
      childConnected: true,
      childSeen: [1, 2],
    });
  } finally {
    await closeOwner(page);
  }
});
