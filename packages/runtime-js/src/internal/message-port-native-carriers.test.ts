import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('preserves native BroadcastChannel delivery after installing port lifetime hooks', () => {
  const module = new URL('./message-port-keepalive.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    input: `
      import { installMessagePortKeepalive } from ${JSON.stringify(module)};
      const results=[];
      for(const installed of [false,true]) {
        if(installed) installMessagePortKeepalive();
        const name='rifty-port-native-'+crypto.randomUUID();
        const sender=new BroadcastChannel(name), receiver=new BroadcastChannel(name);
        try {
          const received=new Promise(resolve=>receiver.onmessage=event=>resolve(event.data));
          sender.postMessage({bytes:[2,5,9]});
          results.push(await received);
        } finally { sender.close(); receiver.close(); }
      }
      console.log(JSON.stringify(results));
    `,
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([{ bytes: [2, 5, 9] }, { bytes: [2, 5, 9] }]);
});
