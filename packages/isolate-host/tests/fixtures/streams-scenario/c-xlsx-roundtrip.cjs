// exceljs 4.4.0: xlsx.readFile (fs.ReadStream + for await) -> edit -> xlsx.writeFile (fs.WriteStream).
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const inF = path.join(__dirname, 'in.xlsx');
const outF = path.join(__dirname, 'out.xlsx');
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(name, 'ok', r === undefined ? '' : r);
    return true;
  } catch (e) {
    console.log(name, 'threw', e2s(e));
    return false;
  }
};
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Revenue');
  ws.addRow(['Region', 'Revenue']);
  ws.addRow(['North', 120]);
  ws.addRow(['South', 95]);
  if (
    !(await step('writeBuffer', async () =>
      fs.writeFileSync(inF, Buffer.from(await wb.xlsx.writeBuffer())),
    ))
  )
    return;
  const wb2 = new ExcelJS.Workbook();
  if (
    !(await step(
      'readFile',
      async () => (await wb2.xlsx.readFile(inF)).getWorksheet('Revenue').getCell('B2').value,
    ))
  )
    return;
  wb2.getWorksheet('Revenue').getCell('B2').value = 999;
  if (!(await step('writeFile', () => wb2.xlsx.writeFile(outF)))) return;
  await step('reload', async () => {
    const wb3 = new ExcelJS.Workbook();
    await wb3.xlsx.load(fs.readFileSync(outF));
    return JSON.stringify(wb3.getWorksheet('Revenue').getSheetValues().filter(Boolean));
  });
})();
