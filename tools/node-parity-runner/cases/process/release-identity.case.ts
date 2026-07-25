import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  expected: JSON.stringify({
    name: 'node',
    moduleSelector: true,
    outer: { writable: false, enumerable: true, configurable: true },
    nameDescriptor: { writable: false, enumerable: true, configurable: true },
    ordinaryPrototype: true,
    extensible: true,
    sealed: false,
    frozen: false,
    assignRelease: 'TypeError',
    assignName: 'TypeError',
    deleteName: true,
    nameAfterDelete: false,
    addExtra: 'ok',
    extra: 'local',
  }),
  code: `
    'use strict';
    const proc = require('node:process');
    const release = proc.release;
    const outer = Object.getOwnPropertyDescriptor(proc, 'release');
    const nameDescriptor = Object.getOwnPropertyDescriptor(release, 'name');
    const outcome = (run) => {
      try { run(); return 'ok'; }
      catch (error) { return error.name; }
    };
    const assignRelease = outcome(() => { proc.release = { name: 'other' }; });
    const assignName = outcome(() => { release.name = 'other'; });
    const deleteName = delete release.name;
    const nameAfterDelete = Object.hasOwn(release, 'name');
    const addExtra = outcome(() => { release.extra = 'local'; });
    const observation = {
      name: nameDescriptor.value,
      moduleSelector: nameDescriptor.value === 'node',
      outer: {
        writable: outer.writable,
        enumerable: outer.enumerable,
        configurable: outer.configurable,
      },
      nameDescriptor: {
        writable: nameDescriptor.writable,
        enumerable: nameDescriptor.enumerable,
        configurable: nameDescriptor.configurable,
      },
      ordinaryPrototype: Object.getPrototypeOf(release) === Object.prototype,
      extensible: Object.isExtensible(release),
      sealed: Object.isSealed(release),
      frozen: Object.isFrozen(release),
      assignRelease,
      assignName,
      deleteName,
      nameAfterDelete,
      addExtra,
      extra: release.extra,
    };
    Object.defineProperty(release, 'name', nameDescriptor);
    delete release.extra;
    console.log(JSON.stringify(observation));
  `,
};

export default c;
