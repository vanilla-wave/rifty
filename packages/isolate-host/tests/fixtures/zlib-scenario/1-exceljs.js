// Step 1: exceljs's streaming WorkbookWriter (archiver → crc32-stream's `class extends zlib.DeflateRaw`).
const { Writable } = require('node:stream');
const { writeOut } = require('./lib.js');
const ExcelJS = require('exceljs');

const chunks = [];
const stream = new Writable({
  write(c, _e, cb) {
    chunks.push(c);
    cb();
  },
});
const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useSharedStrings: true });
wb.created = wb.modified = new Date();
const sheet = wb.addWorksheet('Revenue');
for (let i = 0; i < 5000; i++) sheet.addRow([`region-${i % 17}`, i * 3, i / 7]).commit();
wb.commit().then(() => writeOut('out.xlsx', Buffer.concat(chunks)));
