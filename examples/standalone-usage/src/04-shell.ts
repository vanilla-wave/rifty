// @rifty/shell — a tiny bash-flavoured shell, backed by @rifty/vfs's sync mirror.
// The commands below create their own files, so no pre-seeding is needed.
// Run: `pnpm --filter @rifty-examples/standalone shell`.
import { Shell } from '@rifty/shell';

const sh = new Shell({ cwd: '/proj' });
const result = await sh.run(
  'mkdir -p src && echo "hello rifty" > src/a.txt && cat src/a.txt && ls src',
);

console.log('exitCode :', result.exitCode);
console.log('stdout   :', JSON.stringify(result.stdout));
