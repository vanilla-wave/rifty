import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Tests run the package's real build outputs (child entry + guest bundle). */
export default function setup(): void {
  execFileSync('pnpm', ['run', 'build'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
}
