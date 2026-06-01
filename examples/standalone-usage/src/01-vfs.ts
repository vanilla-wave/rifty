// @rifty/vfs — an in-memory virtual filesystem. Pure JS, runs anywhere (no browser
// plumbing). Run: `pnpm --filter @rifty-examples/standalone vfs`.
import { MemoryVfs, joinPath } from '@rifty/vfs';

const vfs = new MemoryVfs();
await vfs.mkdir('/proj', { recursive: true });
await vfs.writeFile('/proj/hello.txt', 'hi from rifty');

console.log('read :', await vfs.readFileText(joinPath('/proj', 'hello.txt')));
console.log('list :', await vfs.readdir('/proj'));
console.log('stat :', await vfs.stat('/proj/hello.txt'));
