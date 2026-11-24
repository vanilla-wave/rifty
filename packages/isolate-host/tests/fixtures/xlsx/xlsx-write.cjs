// node xlsx-write.cjs <out>: the probe's canonical generator (isolate-library-probe gen/xlsx.cjs): a sheet with header style, numbers, a formula, a date and an image.
const ExcelJS = require('exceljs');
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
  .writeFile(out)
  .then(() => console.log('wrote', out))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
