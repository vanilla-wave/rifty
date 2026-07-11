import type { ParityCase } from '../../src/types.ts';

/**
 * Node 24's ESM view of CJS: one cached namespace, with both `default` and the
 * `module.exports` marker pointing at the exact CJS outer. Named exports are a
 * snapshot, so mutate only a name that Node detects statically and rifty also
 * exposes at runtime; this deliberately avoids the separate name-selection gap.
 */
const c: ParityCase = {
  setup: {
    files: {
      'object.cjs': `
        globalThis.__cjsObjectEvaluations = (globalThis.__cjsObjectEvaluations || 0) + 1;
        const innerDefault = { kind: 'inner-default' };
        function initialNamed() { return 'initial'; }
        const outer = {};
        module.exports = outer;
        module.exports.default = innerDefault;
        module.exports.named = initialNamed;
        module.exports.evaluations = globalThis.__cjsObjectEvaluations;
      `,
      'function.cjs': `
        globalThis.__cjsFunctionEvaluations = (globalThis.__cjsFunctionEvaluations || 0) + 1;
        function functionOuter() { return 'function-outer'; }
        module.exports = functionOuter;
        module.exports.evaluations = globalThis.__cjsFunctionEvaluations;
      `,
      'primitive.cjs': `
        globalThis.__cjsPrimitiveEvaluations = (globalThis.__cjsPrimitiveEvaluations || 0) + 1;
        module.exports = 17;
      `,
    },
  },
  code: `
    globalThis.__cjsObjectEvaluations = 0;
    globalThis.__cjsFunctionEvaluations = 0;
    globalThis.__cjsPrimitiveEvaluations = 0;

    (async () => {
      const objectNamespace = await import('./object.cjs');
      const objectNamespaceAgain = await import('./object.cjs');
      const objectOuter = require('./object.cjs');
      const initialNamed = objectOuter.named;
      console.log('object-initial', JSON.stringify({
        defaultIsOuter: objectNamespace.default === objectOuter,
        markerIsOuter: objectNamespace['module.exports'] === objectOuter,
        ownDefaultPreservedOnOuter: objectOuter.default.kind === 'inner-default',
        namespaceDidNotSelectOwnDefault: objectNamespace.default !== objectOuter.default,
        namedIsInitialFunction: objectNamespace.named === initialNamed,
        repeatedNamespaceIsSame: objectNamespaceAgain === objectNamespace,
        requireAndImportEvaluatedOnce: globalThis.__cjsObjectEvaluations === 1,
      }));

      objectOuter.named = function replacementNamed() { return 'replacement'; };
      console.log('object-after-mutation', JSON.stringify({
        namespaceKeptInitialSnapshot: objectNamespace.named === initialNamed,
        namespaceDidNotFollowOuterMutation: objectNamespace.named !== objectOuter.named,
      }));

      const functionOuter = require('./function.cjs');
      const functionNamespace = await import('./function.cjs');
      console.log('function-outer', JSON.stringify({
        requiredType: typeof functionOuter,
        defaultIsOuter: functionNamespace.default === functionOuter,
        markerIsOuter: functionNamespace['module.exports'] === functionOuter,
        evaluatedOnce: globalThis.__cjsFunctionEvaluations === 1,
      }));

      const primitiveOuter = require('./primitive.cjs');
      const primitiveNamespace = await import('./primitive.cjs');
      console.log('primitive-outer', JSON.stringify({
        requiredValue: primitiveOuter,
        defaultIsOuter: primitiveNamespace.default === primitiveOuter,
        markerIsOuter: primitiveNamespace['module.exports'] === primitiveOuter,
        evaluatedOnce: globalThis.__cjsPrimitiveEvaluations === 1,
      }));
    })().catch((error) => {
      console.log('case-error', error && error.name, error && error.message);
    });
  `,
};

export default c;
