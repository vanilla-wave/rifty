import { expect, it } from 'vitest';
import { runInNode } from '../../src/run-in-node.ts';
import { runInRifty } from '../../src/run-in-rifty.ts';
import {
  constructorCase,
  constructorNodeRows,
  constructorRiftyRows,
} from './public-ipc-advanced-constructor-program.ts';

it('constructor accessors: Node sends mutated bytes; rifty refuses without dispatch or getter execution', async () => {
  expect((await runInNode(constructorCase)).trim().split('\n')).toEqual(constructorNodeRows);
  expect((await runInRifty(constructorCase)).trim().split('\n')).toEqual(constructorRiftyRows);
}, 30_000);
