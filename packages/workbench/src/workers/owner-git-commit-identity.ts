import type { GitIdentity, makeGit } from '@riftydev/git';

type GitConfigReader = Pick<ReturnType<typeof makeGit>, 'getConfig'>;

const DEFAULT_AUTHOR_NAME = 'rifty';
const DEFAULT_AUTHOR_EMAIL = 'rifty@localhost';

export function readOwnerGitEnvironment(): Record<string, string> {
  if (typeof globalThis.process?.env !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(globalThis.process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Owner-realm author identity shared by semantic SCM and the legacy RPC adapter. */
export async function resolveOwnerGitCommitIdentity(
  git: GitConfigReader,
  env: Readonly<Record<string, string>> = readOwnerGitEnvironment(),
): Promise<GitIdentity> {
  const name = env.GIT_AUTHOR_NAME ?? (await git.getConfig('user.name')) ?? DEFAULT_AUTHOR_NAME;
  const email = env.GIT_AUTHOR_EMAIL ?? (await git.getConfig('user.email')) ?? DEFAULT_AUTHOR_EMAIL;
  const date = env.GIT_AUTHOR_DATE;
  const timestamp =
    date !== undefined && /^\d+$/.test(date) ? Number(date) : Math.floor(Date.now() / 1_000);
  return { name, email, timestamp, timezoneOffset: 0 };
}
