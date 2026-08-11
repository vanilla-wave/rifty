import type { ParityCase } from '../../src/types.ts';

/** Node 24 synchronous ESM interop: namespace facade, cache sharing, and overrides. */
const c: ParityCase = {
  setup: {
    files: {
      'facade.mjs': `
        globalThis.__requireEsmFacadeRuns = (globalThis.__requireEsmFacadeRuns || 0) + 1;
        export const named = 'named';
        export const runs = globalThis.__requireEsmFacadeRuns;
        export let mutable = 1;
        export function bump() { mutable += 1; }
        export default { kind: 'default' };
      `,
      'explicit.mjs': `
        export const __esModule = 'authored';
        export default 'explicit-default';
      `,
      'override.mjs': `
        globalThis.__requireEsmOverrideRuns = (globalThis.__requireEsmOverrideRuns || 0) + 1;
        function primary() { return 'primary'; }
        export { primary as 'module.exports' };
        export { primary };
        export default 'namespace-default';
      `,
    },
  },
  code: `
    globalThis.__requireEsmFacadeRuns = 0;
    globalThis.__requireEsmOverrideRuns = 0;

    const required = require('./facade.mjs');
    const requiredAgain = require('./facade.mjs');
    const explicit = require('./explicit.mjs');
    const overridden = require('./override.mjs');
    const mutableBefore = required.mutable;
    required.bump();

    (async () => {
      const imported = await import('./facade.mjs');
      const explicitImported = await import('./explicit.mjs');
      const overrideImported = await import('./override.mjs');

      console.log(JSON.stringify({
        named: required.named,
        defaultKind: required.default.kind,
        syntheticEsModule: required.__esModule,
        syntheticIsOwn: Object.hasOwn(required, '__esModule'),
        syntheticEnumerable: Object.prototype.propertyIsEnumerable.call(required, '__esModule'),
        repeatedRequireIdentity: requiredAgain === required,
        importIdentity: imported === required,
        importedDefaultIdentity: imported.default === required.default,
        mutableBefore,
        mutableFromRequire: required.mutable,
        mutableFromImport: imported.mutable,
        facadeRuns: globalThis.__requireEsmFacadeRuns,
        exportedRuns: required.runs,
        explicitEsModule: explicit.__esModule,
        explicitIdentity: explicitImported === explicit,
        overrideType: typeof overridden,
        overrideCall: overridden(),
        overrideIsBinding: overridden === overrideImported['module.exports'],
        overrideIsNamespace: overridden === overrideImported,
        overrideNamedHidden: overridden.primary === undefined,
        overrideRuns: globalThis.__requireEsmOverrideRuns,
        processRequireModule: require('node:process').features.require_module,
      }));
    })();
  `,
  expected:
    '{"named":"named","defaultKind":"default","syntheticEsModule":true,"syntheticIsOwn":true,"syntheticEnumerable":true,"repeatedRequireIdentity":true,"importIdentity":false,"importedDefaultIdentity":true,"mutableBefore":1,"mutableFromRequire":2,"mutableFromImport":2,"facadeRuns":1,"exportedRuns":1,"explicitEsModule":"authored","explicitIdentity":true,"overrideType":"function","overrideCall":"primary","overrideIsBinding":true,"overrideIsNamespace":false,"overrideNamedHidden":true,"overrideRuns":1,"processRequireModule":true}\n',
};

export default c;
