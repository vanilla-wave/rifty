// Hero terminal boot log — looping typewriter reveal. Cosmetic only.
// Copy ported verbatim from docs/landing/handoff/Rifty.dc.html (bootScript).

// One log line: prompt prefix + text + a color class (mapped to a CSS var).
interface BootLine {
  readonly p: string;
  readonly t: string;
  readonly c: 'cmd' | 'dim' | 'ok' | 'lime' | 'req';
}

const BOOT_SCRIPT: readonly BootLine[] = [
  { p: '$ ', t: 'npm install express', c: 'cmd' },
  { p: '  ', t: 'resolving via @riftydev/npm-client', c: 'dim' },
  { p: '  ', t: '+ express@4.21.2  ·  57 pkgs  ·  0 conflicts', c: 'ok' },
  { p: '$ ', t: 'node server.js', c: 'cmd' },
  { p: '  ', t: 'runtime-js · node v22 compatible', c: 'dim' },
  { p: '  ', t: 'express listening on :3000', c: 'lime' },
  { p: '', t: 'GET /   200   ·   4 ms', c: 'req' },
];

// per-line reveal delay (ms) and the hold before the loop restarts.
const LINE_DELAY = 620;
const LOOP_HOLD = 2600;

// Track timers per element so a re-run clears the old loop.
const timers = new WeakMap<HTMLElement, number[]>();

function clearTimers(el: HTMLElement): void {
  const handles = timers.get(el);
  if (handles) {
    for (const id of handles) {
      clearTimeout(id);
    }
  }
  timers.set(el, []);
}

function push(el: HTMLElement, id: number): void {
  const handles = timers.get(el);
  if (handles) {
    handles.push(id);
  }
}

function makeLine(line: BootLine): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'hero-term-row';
  const prompt = document.createElement('span');
  prompt.className = 'hero-term-prompt';
  prompt.textContent = line.p;
  const text = document.createElement('span');
  text.className = `hero-term-text hero-term-${line.c}`;
  text.textContent = line.t;
  row.append(prompt, text);
  return row;
}

function makeCursorRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'hero-term-row';
  const prompt = document.createElement('span');
  prompt.className = 'hero-term-prompt';
  prompt.textContent = '$ ';
  const cursor = document.createElement('span');
  cursor.className = 'hero-term-cursor';
  row.append(prompt, cursor);
  return row;
}

/**
 * Start the looping hero boot log inside `el`. Reveals each line on a timer,
 * holds, then clears and replays. Re-running clears the previous loop.
 */
export function startTerminalLog(el: HTMLElement): void {
  clearTimers(el);

  const cursorRow = makeCursorRow();

  const runOnce = (): void => {
    el.replaceChildren(cursorRow);
    BOOT_SCRIPT.forEach((line, i) => {
      const id = window.setTimeout(
        () => {
          cursorRow.before(makeLine(line));
        },
        LINE_DELAY * (i + 1),
      );
      push(el, id);
    });
    const total = LINE_DELAY * (BOOT_SCRIPT.length + 1) + LOOP_HOLD;
    const loopId = window.setTimeout(runOnce, total);
    push(el, loopId);
  };

  runOnce();
}
