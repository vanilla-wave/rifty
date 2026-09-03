import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/a.js': `
        const plain = require('console');
        const node = require('node:console');
        setTimeout(() => {
          console.log('A-global', { child: 1 });
          plain.log('A-plain', console === plain, plain === node);
          node.error('A-node');
        }, 10);
      `,
      'project/b.js': `
        const plain = require('console');
        const node = require('node:console');
        globalThis[Symbol.unscopables] = { console: true };
        setTimeout(() => {
          console.log('B-global', { child: 2 });
          plain.log('B-plain', console === plain, plain === node);
          node.error('B-node');
        }, 0);
      `,
    },
  },
  code: `
    const { spawn } = require('node:child_process');
    const ownerFrames = [];
    const ownerMethods = ['log', 'info', 'debug', 'warn', 'error'];
    const ownerConsole = console;
    const savedDefineProperty = Object.defineProperty;
    const savedDefineProperties = Object.defineProperties;
    const savedReflectDefineProperty = Reflect.defineProperty;
    const savedOwnerConsole = Object.fromEntries(
      ownerMethods.map((method) => [method, ownerConsole[method]]),
    );
    for (const method of ownerMethods) {
      ownerConsole[method] = (...args) => { ownerFrames.push([method, ...args]); };
    }
    const savedConsoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'console');
    let consoleWrites = 0;
    savedDefineProperty(globalThis, 'console', {
      configurable: true,
      enumerable: savedConsoleDescriptor?.enumerable ?? false,
      get: () => ownerConsole,
      set: () => { consoleWrites += 1; },
    });
    const consoleDescriptorWrites = {
      defineProperty: 0,
      defineProperties: 0,
      reflectDefineProperty: 0,
    };
    Object.defineProperty = (target, key, descriptor) => {
      if (target === globalThis && key === 'console') consoleDescriptorWrites.defineProperty += 1;
      return savedDefineProperty(target, key, descriptor);
    };
    Object.defineProperties = (target, descriptors) => {
      if (target === globalThis && Object.hasOwn(descriptors, 'console')) {
        consoleDescriptorWrites.defineProperties += 1;
      }
      return savedDefineProperties(target, descriptors);
    };
    Reflect.defineProperty = (target, key, descriptor) => {
      if (target === globalThis && key === 'console') {
        consoleDescriptorWrites.reflectDefineProperty += 1;
      }
      return savedReflectDefineProperty(target, key, descriptor);
    };
    function run(file) {
      return new Promise((resolve) => {
        const child = spawn('node', [file], { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      });
    }
    Promise.all([run('a.js'), run('b.js')]).then(([a, b]) => {
      Object.defineProperty = savedDefineProperty;
      Object.defineProperties = savedDefineProperties;
      Reflect.defineProperty = savedReflectDefineProperty;
      if (savedConsoleDescriptor) {
        savedDefineProperty(globalThis, 'console', savedConsoleDescriptor);
      } else {
        delete globalThis.console;
      }
      const restored = Object.getOwnPropertyDescriptor(globalThis, 'console');
      const descriptorRestored = savedConsoleDescriptor
        ? restored?.configurable === savedConsoleDescriptor.configurable &&
          restored?.enumerable === savedConsoleDescriptor.enumerable &&
          restored?.writable === savedConsoleDescriptor.writable &&
          restored?.value === savedConsoleDescriptor.value &&
          restored?.get === savedConsoleDescriptor.get &&
          restored?.set === savedConsoleDescriptor.set
        : restored === undefined;
      for (const method of ownerMethods) ownerConsole[method] = savedOwnerConsole[method];
      ownerConsole.log(JSON.stringify({
        a,
        b,
        ownerFrames,
        consoleWrites,
        consoleDescriptorWrites,
        descriptorRestored,
      }));
    });
  `,
  expected:
    '{"a":{"code":0,"signal":null,"stdout":"A-global { child: 1 }\\nA-plain true true\\n","stderr":"A-node\\n"},' +
    '"b":{"code":0,"signal":null,"stdout":"B-global { child: 2 }\\nB-plain true true\\n","stderr":"B-node\\n"},' +
    '"ownerFrames":[],"consoleWrites":0,"consoleDescriptorWrites":{' +
    '"defineProperty":0,"defineProperties":0,"reflectDefineProperty":0},' +
    '"descriptorRestored":true}',
} satisfies ParityCase;
