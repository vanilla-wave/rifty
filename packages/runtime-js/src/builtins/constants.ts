import { NotImplementedError } from '@riftydev/io';
import { constants as cryptoConstants } from './crypto.ts';
import { constants as fsConstants } from './fs.ts';
import { constants as osConstants } from './os.ts';

type NodeConstantValue = number | string;

const implementedConstants = Object.freeze({
  ...fsConstants,
  ...osConstants.signals,
  ...osConstants.errno,
  ...osConstants.priority,
  ...osConstants.dlopen,
  ...cryptoConstants,
} satisfies Record<string, NodeConstantValue>);

export const constants: Readonly<Record<string, NodeConstantValue>> = new Proxy(
  implementedConstants,
  {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      if (prop === '__esModule' || prop === 'default' || prop === 'then') return undefined;
      if (prop in target) return Reflect.get(target, prop, receiver);
      // TODO(backlog: runtime-js/node-constants-residual-static-surface)
      throw new NotImplementedError(`constants.${prop}`);
    },
  },
);

export default constants;
