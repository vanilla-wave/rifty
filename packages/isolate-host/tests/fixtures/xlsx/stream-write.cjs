// node stream-write.cjs <out>: exceljs's streaming writer, which deflates through node:zlib.
const WorkbookWriter = require('exceljs/lib/stream/xlsx/workbook-writer');
const out = process.argv[2];
const wb = new WorkbookWriter({ filename: out });
wb.addWorksheet('Revenue').addRow(['North', 120]).commit();
wb.commit().then(() => console.log('wrote', out));
