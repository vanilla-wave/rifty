module.exports = { now: () => (typeof performance === 'object' ? performance.now() : Date.now()) };
