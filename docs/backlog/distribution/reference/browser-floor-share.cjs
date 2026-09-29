// node browser-floor-share.cjs /tmp/isolated/node_modules
const { resolve } = require('node:path');
const base = resolve(process.argv[2]);
const { agents, region } = require(`${base}/caniuse-lite`);
const data = {
  global: Object.fromEntries(
    Object.entries(agents).map(([key, value]) => [key, value.usage_global]),
  ),
  RU: region(require(`${base}/caniuse-lite/data/regions/RU`)),
};
const floors = {
  persistent: {
    chrome: 108,
    edge: 108,
    firefox: 114,
    safari: 26,
    ios_saf: 26,
    and_chr: 109,
    and_ff: 114,
    samsung: 21,
    opera: 94,
    op_mob: 74,
  },
  ephemeral: {
    chrome: 98,
    edge: 98,
    firefox: 114,
    safari: 16.4,
    ios_saf: 16.4,
    and_chr: 98,
    and_ff: 114,
    samsung: 18,
    opera: 84,
    op_mob: 68,
  },
};
const rows = [];
for (const [area, usage] of Object.entries(data)) {
  const tracked = Object.values(usage)
    .flatMap((versions) => Object.values(versions))
    .reduce((a, b) => a + b, 0);
  for (const [persistence, minimum] of Object.entries(floors)) {
    for (const coi of [false, true]) {
      let eligible = 0;
      for (const [agent, versions] of Object.entries(usage)) {
        let floor = minimum[agent];
        if (coi && ['safari', 'ios_saf'].includes(agent)) continue;
        if (coi && ['firefox', 'and_ff'].includes(agent)) floor = 145;
        if (floor === undefined) continue;
        // Range buckets count only if their lowest numeric version meets the floor.
        for (const [version, weight] of Object.entries(versions))
          if (Number.parseFloat(version) >= floor) eligible += weight;
      }
      rows.push({
        area,
        persistence,
        coi,
        eligible,
        tracked,
        percentOfTracked: (eligible / tracked) * 100,
      });
    }
  }
}
console.log(
  JSON.stringify(
    {
      date: '2026-09-28',
      caniuse: require(`${base}/caniuse-lite/package.json`).version,
      bcd: require(`${base}/@mdn/browser-compat-data/package.json`).version,
      floors,
      rows,
    },
    null,
    2,
  ),
);
