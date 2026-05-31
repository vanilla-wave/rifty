import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const dc = require('node:diagnostics_channel');
    const ch = dc.channel('rifty:test');
    const log = [];
    log.push(['hasSub-initial', ch.hasSubscribers]);
    log.push(['name', ch.name]);
    const onMsg = (msg, name) => log.push(['recv', msg.a, name]);
    // identity: channel(name) returns the same object for the same name
    log.push(['identity', dc.channel('rifty:test') === ch]);
    dc.subscribe('rifty:test', onMsg);
    log.push(['hasSub-after-sub', ch.hasSubscribers]);
    ch.publish({ a: 1 });
    const removed = dc.unsubscribe('rifty:test', onMsg);
    log.push(['unsub-return', removed]);
    log.push(['hasSub-after-unsub', ch.hasSubscribers]);
    ch.publish({ a: 2 }); // no subscriber -> no recv entry
    // channel-method subscribe/unsubscribe form
    ch.subscribe(onMsg);
    log.push(['hasSub-method-sub', ch.hasSubscribers]);
    ch.publish({ a: 3 });
    ch.unsubscribe(onMsg);
    log.push(['hasSub-final', ch.hasSubscribers]);
    console.log(JSON.stringify(log));
  `,
};

export default c;
