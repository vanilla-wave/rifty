// explicit-busy: terminate the child, then stay busy while the page terminates
// this parent. cascade-busy: same, but leave the child to this realm's end.
const config = JSON.parse(self.name);
const busy = (ms) => {
  const until = performance.now() + ms;
  while (performance.now() < until) {}
};
self.addEventListener('message', () => {
  const children = [];
  let started = 0;
  for (let index = 0; index < config.children; index += 1) {
    const child = new Worker('child.js');
    children.push(child);
    child.onmessage = () => {
      started += 1;
      if (started < config.children) return;
      if (config.variant === 'explicit-busy') for (const each of children) each.terminate();
      postMessage('ready');
      busy(config.busy);
    };
  }
});
