import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  code: `const fs=require('fs');
fs.writeFileSync('file','hello');fs.mkdirSync('dir');
const fields=['dev','ino','mode','nlink','uid','gid','rdev','size','blksize','blocks','atimeMs','mtimeMs','ctimeMs','birthtimeMs'];
const fd=fs.openSync('file','r');
const values=[fs.statSync('file'),fs.lstatSync('file'),fs.fstatSync(fd),fs.statSync('dir')];
const shape=values.map(s=>({
 fields:fields.map(k=>[k,typeof s[k],Number.isFinite(s[k])]),
 dates:['atime','mtime','ctime','birthtime'].map(k=>[k,s[k] instanceof Date,Number.isFinite(+s[k])]),
 file:s.isFile(),directory:s.isDirectory(),type:s.mode & 0o170000,
 stable:s.isDirectory()||s.ino===values[0].ino,
}));
fs.closeSync(fd);
const before=fs.statSync('file');fs.writeFileSync('file','changed');
const written=fs.statSync('file');fs.renameSync('file','renamed');const renamed=fs.statSync('renamed');
fs.mkdirSync('dir/nested');
console.log(JSON.stringify({shape,
 identity:[before.ino===written.ino,written.ino===renamed.ino],
 birth:[before.birthtimeMs===written.birthtimeMs,written.birthtimeMs===renamed.birthtimeMs],
 links:fs.statSync('dir').nlink===values[3].nlink+1,
}));`,
} satisfies ParityCase;
