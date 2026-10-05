import type { ParityCase } from '../../src/types.ts';
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    function frame(stack, file) { return stack.match(new RegExp(file.replaceAll('.', '\\\\.') + ':[-0-9]+:[-0-9]+'))?.[0]; }
    for (const source of ['new Error().stack', '\\nnew Error().stack']) {
      for (const columnOffset of [-20, 5]) {
        console.log(frame(vm.runInThisContext(source, {filename:'/virtual/offset.js',lineOffset:10,columnOffset}), '/virtual/offset.js'));
      }
    }
    const earlier = vm.runInThisContext('(function(){return new Error().stack})', {filename:'/virtual/shared.js',lineOffset:4,columnOffset:3});
    const later = vm.runInThisContext('(function(){return new Error().stack})', {filename:'/virtual/shared.js',lineOffset:8,columnOffset:9});
    console.log(frame(earlier(), '/virtual/shared.js'), frame(later(), '/virtual/shared.js'));
    const script = new vm.Script('new Error().stack', {filename:'/virtual/script.js',lineOffset:7,columnOffset:2});
    console.log(frame(script.runInThisContext(), '/virtual/script.js'));
  `,
};
export default c;
