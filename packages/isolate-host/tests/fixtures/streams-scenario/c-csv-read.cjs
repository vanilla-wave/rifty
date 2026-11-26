// exceljs 4.4.0 csv.readFile: fs.createReadStream(...).pipe(fast-csv parse Transform).
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const f = path.join(__dirname, 'in.csv');
fs.writeFileSync(f, 'Region,Revenue\nNorth,120\n"South, East",95.5\nZürich ✓,-3\n');
(async () => {
  try {
    const ws = await new ExcelJS.Workbook().csv.readFile(f);
    console.log('csv', JSON.stringify(ws.getSheetValues().filter(Boolean)));
  } catch (e) {
    console.log('csv threw', e2s(e));
  }
})();
