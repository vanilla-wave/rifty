import { NotImplementedError } from '@riftydev/io';

/** Registry identity of an npm alias; placement keeps the dependency key. */
export function parseNpmAlias(spec: string | null): { name: string; range: string } | null {
  if (spec === null || !/^npm:/i.test(spec.trim())) return null;
  const target = spec.trim().slice(4);
  const at = target.lastIndexOf('@');
  const name = at > 0 ? target.slice(0, at) : target;
  const range = at > 0 ? target.slice(at + 1) || '*' : '*';
  if (
    !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) ||
    /^(?:npm:|file:|https?:|git\+|workspace:)/i.test(range)
  ) {
    throw new NotImplementedError('npm-client.dependency-spec.npm-alias-target', spec);
  }
  return { name, range };
}
