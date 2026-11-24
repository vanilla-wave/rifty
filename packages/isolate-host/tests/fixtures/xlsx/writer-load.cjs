// node writer-load.cjs: exceljs's streaming writer module, which loads node:zlib through
// archiver → zip-stream → compress-commons → crc32-stream (`class extends zlib.DeflateRaw`).
const WorkbookWriter = require('exceljs/lib/stream/xlsx/workbook-writer');
const { DeflateCRC32Stream } = require('crc32-stream');
console.log(typeof WorkbookWriter, WorkbookWriter.name, DeflateCRC32Stream.name);
console.log(Object.getPrototypeOf(DeflateCRC32Stream) === require('node:zlib').DeflateRaw);
