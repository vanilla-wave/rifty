import { inflateSync } from 'node:zlib';
import { type Page, expect, test } from '@playwright/test';
import { bootShell, runTerminalLineSettled } from './helpers/playground.ts';

async function openShellTerminal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New terminal' }).click();
  await expect(page.getByRole('tab', { name: /Terminal 2/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function runCommand(page: Page, command: string): Promise<void> {
  await runTerminalLineSettled(page, command);
}

interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function parseRgbaPng(bytes: Buffer): PngImage {
  const signature = '89504e470d0a1a0a';
  expect(bytes.subarray(0, 8).toString('hex')).toBe(signature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      expect(chunk[8]).toBe(8);
      colorType = chunk[9] ?? -1;
    }
    if (type === 'IDAT') idat.push(chunk);
    offset += 12 + length;
  }

  expect([2, 6]).toContain(colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rawStride = width * bytesPerPixel;
  const out = new Uint8Array(height * width * 4);
  const previous = new Uint8Array(rawStride);
  const current = new Uint8Array(rawStride);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[src++] ?? 0;
    current.fill(0);
    for (let x = 0; x < rawStride; x++) {
      const value = raw[src++] ?? 0;
      const left = x >= bytesPerPixel ? (current[x - bytesPerPixel] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
      let decoded = value;
      if (filter === 1) decoded += left;
      else if (filter === 2) decoded += up;
      else if (filter === 3) decoded += Math.floor((left + up) / 2);
      else if (filter === 4) decoded += paeth(left, up, upLeft);
      else expect(filter).toBe(0);
      current[x] = decoded & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const rawIdx = x * bytesPerPixel;
      const outIdx = (y * width + x) * 4;
      out[outIdx] = current[rawIdx] ?? 0;
      out[outIdx + 1] = current[rawIdx + 1] ?? 0;
      out[outIdx + 2] = current[rawIdx + 2] ?? 0;
      out[outIdx + 3] = colorType === 6 ? (current[rawIdx + 3] ?? 255) : 255;
    }
    previous.set(current);
  }

  return { width, height, data: out };
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function isNearColor(
  image: PngImage,
  x: number,
  y: number,
  target: readonly [number, number, number],
): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const idx = (y * image.width + x) * 4;
  const alpha = image.data[idx + 3] ?? 0;
  if (alpha < 180) return false;
  const tolerance = 34;
  return (
    Math.abs((image.data[idx] ?? 0) - target[0]) <= tolerance &&
    Math.abs((image.data[idx + 1] ?? 0) - target[1]) <= tolerance &&
    Math.abs((image.data[idx + 2] ?? 0) - target[2]) <= tolerance
  );
}

async function firstCellStatusFills(
  page: Page,
): Promise<
  Array<{ readonly row: number; readonly greenSamples: number; readonly redSamples: number }>
> {
  const terminal = page.locator('[data-testid="terminal"]');
  const metrics = await terminal.evaluate((element) => {
    const termRect = element.getBoundingClientRect();
    const rowsRect = element.querySelector('.xterm-rows')?.getBoundingClientRect();
    const measureElement = element.querySelector('.xterm-char-measure-element');
    const measureRect = measureElement?.getBoundingClientRect();
    const rowRects = Array.from(element.querySelectorAll('.xterm-rows > div')).map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - termRect.top, height: rect.height };
    });
    return {
      rowsLeft: rowsRect ? rowsRect.left - termRect.left : 0,
      cellWidth: measureRect
        ? measureRect.width / Math.max(1, measureElement?.textContent?.length ?? 1)
        : 8,
      rowRects,
    };
  });
  expect(metrics.rowRects.length).toBeGreaterThan(0);
  expect(metrics.cellWidth).toBeGreaterThan(0);
  const image = parseRgbaPng(await terminal.screenshot());
  const statusGreen = [46, 160, 67] as const;
  const statusRed = [248, 81, 73] as const;
  const fills: Array<{ row: number; greenSamples: number; redSamples: number }> = [];

  for (let row = 0; row < metrics.rowRects.length; row++) {
    const rect = metrics.rowRects[row];
    if (!rect) continue;
    const x0 = Math.max(0, Math.floor(metrics.rowsLeft));
    const x1 = Math.min(image.width, Math.ceil(metrics.rowsLeft + metrics.cellWidth));
    const y0 = Math.max(0, Math.floor(rect.top + 1));
    const y1 = Math.min(image.height, Math.ceil(rect.top + rect.height - 1));
    let greenSamples = 0;
    let redSamples = 0;
    for (const xRatio of [0.18, 0.36, 0.64, 0.82]) {
      for (const yRatio of [0.16, 0.34, 0.66, 0.84]) {
        const x = Math.min(x1 - 1, Math.max(x0, Math.floor(x0 + (x1 - x0) * xRatio)));
        const y = Math.min(y1 - 1, Math.max(y0, Math.floor(y0 + (y1 - y0) * yRatio)));
        if (isNearColor(image, x, y, statusGreen)) greenSamples++;
        if (isNearColor(image, x, y, statusRed)) redSamples++;
      }
    }
    if (greenSamples >= 8 || redSamples >= 8) fills.push({ row, greenSamples, redSamples });
  }

  return fills;
}

async function expectNoStatusFillInTextPlane(page: Page): Promise<void> {
  expect(await firstCellStatusFills(page)).toEqual([]);
}

function colorAt(image: PngImage, x: number, y: number): readonly [number, number, number] {
  const idx = (y * image.width + x) * 4;
  return [image.data[idx] ?? 0, image.data[idx + 1] ?? 0, image.data[idx + 2] ?? 0];
}

function colorDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

async function promptCellCursorBars(
  page: Page,
): Promise<
  Array<{ readonly row: number; readonly x: number; readonly run: number; readonly height: number }>
> {
  const terminal = page.locator('[data-testid="terminal"]');
  const metrics = await terminal.evaluate((element) => {
    const termRect = element.getBoundingClientRect();
    const rowsRect = element.querySelector('.xterm-rows')?.getBoundingClientRect();
    const measureElement = element.querySelector('.xterm-char-measure-element');
    const measureRect = measureElement?.getBoundingClientRect();
    const rowRects = Array.from(element.querySelectorAll('.xterm-rows > div')).map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - termRect.top, height: rect.height };
    });
    return {
      rowsLeft: rowsRect ? rowsRect.left - termRect.left : 0,
      cellWidth: measureRect
        ? measureRect.width / Math.max(1, measureElement?.textContent?.length ?? 1)
        : 8,
      rowRects,
    };
  });
  expect(metrics.rowRects.length).toBeGreaterThan(0);
  expect(metrics.cellWidth).toBeGreaterThan(0);
  const image = parseRgbaPng(await terminal.screenshot());
  const bars: Array<{ row: number; x: number; run: number; height: number }> = [];

  for (let row = 0; row < metrics.rowRects.length; row++) {
    const rect = metrics.rowRects[row];
    if (!rect) continue;
    const x0 = Math.max(0, Math.floor(metrics.rowsLeft));
    const x1 = Math.min(image.width, Math.ceil(metrics.rowsLeft + metrics.cellWidth * 2));
    const bgX = Math.min(image.width - 1, Math.max(x1 + 8, image.width - 6));
    const y0 = Math.max(0, Math.floor(rect.top + 2));
    const y1 = Math.min(image.height, Math.ceil(rect.top + rect.height - 2));
    const height = y1 - y0;
    if (height <= 0) continue;
    const background = colorAt(image, bgX, Math.floor((y0 + y1) / 2));
    for (let x = x0; x < x1; x++) {
      let run = 0;
      for (let y = y0; y < y1; y++) {
        if (colorDistance(colorAt(image, x, y), background) > 72) run++;
      }
      if (run >= Math.ceil(height * 0.72)) bars.push({ row, x, run, height });
    }
  }

  return bars;
}

async function expectNoNewCursorBarBeforePrompt(
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  const before = new Set((await promptCellCursorBars(page)).map((bar) => `${bar.row}:${bar.x}`));
  await action();
  const after = await promptCellCursorBars(page);
  expect(after.filter((bar) => !before.has(`${bar.row}:${bar.x}`))).toEqual([]);
}

test.describe('Terminal visual regressions', () => {
  test('command status never paints over the first text cell', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);

    await runCommand(page, 'ls');
    await expectNoStatusFillInTextPlane(page);

    await runCommand(page, 'src');
    await expectNoStatusFillInTextPlane(page);
  });

  test('typing at the prompt does not flash stale status cells at line start', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);

    await runCommand(page, 'ls');
    await runCommand(page, 'src');
    await page.locator('[data-testid="terminal"]').click();

    for (const char of 'node 1.js') {
      await expectNoNewCursorBarBeforePrompt(page, () => page.keyboard.type(char));
      await expectNoStatusFillInTextPlane(page);
    }
  });
});
