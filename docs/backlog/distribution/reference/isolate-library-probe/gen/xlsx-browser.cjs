// xlsx.cjs over exceljs's browser bundle (dist/exceljs.min.js: browserify polyfills inside),
// written as a buffer.
const fs = require('node:fs');
const ExcelJS = require('exceljs/dist/exceljs.min.js');
const out = process.argv[2];
const wb = new ExcelJS.Workbook();
wb.creator = 'probe';
const ws = wb.addWorksheet('Revenue');
ws.columns = [
  { header: 'Region', key: 'region', width: 16 },
  { header: 'Revenue', key: 'revenue', width: 12 },
];
ws.addRow({ region: 'North', revenue: 120 });
ws.addRow({ region: 'South', revenue: 95 });
ws.getCell('A4').value = 'Total';
ws.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 215 };
ws.getCell('A5').value = new Date(Date.UTC(2026, 10, 24));
ws.getRow(1).font = { bold: true };
const img = wb.addImage({
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  extension: 'png',
});
ws.addImage(img, 'D2:E4');
wb.xlsx
  .writeBuffer()
  .then((buf) => {
    fs.writeFileSync(out, buf);
    console.log('wrote', out);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
