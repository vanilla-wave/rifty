import './gauge.css';

// Depth gauge — a decorative nod to the Rifters trilogy. Pinned to the page's
// right edge, hidden below 900px. Purely visual: aria-hidden, no pointer events.
const MARKS: ReadonlyArray<readonly [top: string, label: string]> = [
  ['8px', '0 m'],
  ['28%', '−900 m'],
  ['54%', '−1 800 m'],
  ['76%', '−3 000 m'],
];

export function renderDepthGauge(): HTMLElement {
  const gauge = document.createElement('div');
  gauge.className = 'gauge';
  gauge.setAttribute('aria-hidden', 'true');

  const fine = document.createElement('div');
  fine.className = 'gauge-rail gauge-rail-fine';
  const coarse = document.createElement('div');
  coarse.className = 'gauge-rail gauge-rail-coarse';
  gauge.append(fine, coarse);

  for (const [top, label] of MARKS) {
    const mark = document.createElement('span');
    mark.className = 'gauge-mark';
    mark.style.top = top;
    mark.textContent = label;
    gauge.append(mark);
  }

  const vent = document.createElement('span');
  vent.className = 'gauge-mark gauge-vent';
  vent.textContent = '−3 300 m · vent';
  const dot = document.createElement('span');
  dot.className = 'gauge-dot';
  gauge.append(vent, dot);
  return gauge;
}
