import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Tests run the packages' real build outputs: the export's guest bundle, then the host (which copies it). */
export default function setup(): void {
  for (const dir of ['../../isolate-guest', '..']) {
    execFileSync('pnpm', ['run', 'build'], {
      cwd: fileURLToPath(new URL(dir, import.meta.url)),
      stdio: 'inherit',
    });
  }
}
