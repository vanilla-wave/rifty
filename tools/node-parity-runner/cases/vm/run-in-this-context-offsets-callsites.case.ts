import type { ParityCase } from '../../src/types.ts';

// CallSites of an offset script as a guest Error.prepareStackTrace hook sees
// them (unit runtime-js/vm-run-in-this-context-offsets). Shape = vitest 4.1.11
// module-evaluator (`'use strict';async (…)=>{{` + code, columnOffset
// -prefix.length) under vite 8.0.16 module-runner interceptStackTrace (hook
// assigned before evaluation, CallSites cloned through their prototype's own
// names, `getFileName() || getScriptNameOrSourceURL()`), then the callsites-style
// save/restore pattern and vite's reset to the original hook.
const c: ParityCase = {
  code: String.raw`
    const vm = require('node:vm');
    const originalPrepare = Error.prepareStackTrace;
    const ours = (site) => String(site.getScriptNameOrSourceURL()).startsWith('/virtual/');
    const pick = (site) =>
      [
        site.getFileName() || site.getScriptNameOrSourceURL(),
        site.getLineNumber(),
        site.getColumnNumber(),
        site.getEnclosingLineNumber(),
        site.getEnclosingColumnNumber(),
        site.getFunctionName(),
      ].map(String).join(',');
    function cloneCallSite(frame) {
      const object = {};
      Object.getOwnPropertyNames(Object.getPrototypeOf(frame)).forEach((name) => {
        object[name] = /^(?:is|get)/.test(name) ? function () { return frame[name].call(frame); } : frame[name];
      });
      return object;
    }
    Error.prepareStackTrace = function prepareStackTrace(error, stack) {
      return error.message + ' => ' + stack.filter(ours).map((frame) => pick(cloneCallSite(frame)) + ' [' + String(frame) + ']').join(' | ');
    };

    const codeDefinition = "'use strict';async (__vite_ssr_exports__,__vite_ssr_import_meta__)=>{{";
    const code =
      'function atLine1() { throw new Error("one") } __vite_ssr_exports__.atLine1 = atLine1;\n' +
      '__vite_ssr_exports__.atLine2 = function atLine2() {\n' +
      '  throw new Error("three") };\n' +
      '__vite_ssr_exports__.sites = function sites() { return new Error("sites").stack };';
    const filename = '/virtual/my project/src/sum.test.ts';
    const moduleFn = vm.runInThisContext(codeDefinition + code + '\n}}', { filename, lineOffset: 0, columnOffset: -codeDefinition.length });
    const exportsObject = {};
    const evaluated = moduleFn(exportsObject, {});
    const settle = (fn) => {
      try {
        return fn();
      } catch (error) {
        return error.stack;
      }
    };

    evaluated.then(() => {
      console.log('vite-hook line1', settle(exportsObject.atLine1));
      console.log('vite-hook line3', settle(exportsObject.atLine2));

      // callsites-style save / raw-array / restore.
      const saved = Error.prepareStackTrace;
      Error.prepareStackTrace = (_, callSites) => callSites;
      const sites = exportsObject.sites();
      Error.prepareStackTrace = saved;
      console.log('callsites-pattern', sites.filter(ours).map(pick).join(' | '));

      // A hook installed after the script was evaluated sees the offsets too.
      Error.prepareStackTrace = (error, stack) => stack.filter(ours).map((site) => site.getLineNumber() + ':' + site.getColumnNumber()).join(' | ');
      console.log('late-hook', settle(exportsObject.atLine1));

      // vite resetInterceptor: back to the original hook; default rendering keeps the offsets.
      Error.prepareStackTrace = originalPrepare;
      console.log('restored typeof', typeof Error.prepareStackTrace);
      const token = /\/virtual\/my project\/src\/sum\.test\.ts(?::-?\d+){0,2}/;
      const rendered = (stack) => String(stack).split('\n').map((line) => line.trim()).filter((line) => line.startsWith('at ') && token.test(line)).map((line) => token.exec(line)[0]).join(' | ');
      console.log('restored default line1', rendered(settle(exportsObject.atLine1)));
      console.log('restored default line3', rendered(settle(exportsObject.atLine2)));

      // Shifted positions <= 0: CallSite getters return null.
      const boundaries = [
        ['col1', '(function top() { return new Error("e") })', { filename: '/virtual/bound.js', columnOffset: -25 }],
        ['line0-col0', '(function top() { return new Error("e") })', { filename: '/virtual/bound.js', lineOffset: -1, columnOffset: -26 }],
        ['negative-line', '\n(function top() {\n return new Error("e") })', { filename: '/virtual/bound.js', lineOffset: -4, columnOffset: -50 }],
      ];
      for (const [label, source, options] of boundaries) {
        const make = vm.runInThisContext(source, options);
        const before = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, callSites) => callSites;
        const boundarySites = make().stack;
        Error.prepareStackTrace = before;
        console.log('boundary', label, boundarySites.filter(ours).map(pick).join(' | '));
      }
    });
  `,
};

export default c;
