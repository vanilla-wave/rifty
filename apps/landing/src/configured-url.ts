export function requireAbsoluteHttpUrl(raw: string | undefined, key: string): string {
  if (!raw) throw new Error(`${key} must be configured as an absolute http(s) URL`);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be configured as an absolute http(s) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${key} must be configured as an absolute http(s) URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${key} must not contain credentials`);
  }
  return url.href;
}

export function requireSiteBaseUrl(raw: string | undefined): string {
  const url = new URL(requireAbsoluteHttpUrl(raw, 'VITE_RIFTY_SITE_URL'));
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_RIFTY_SITE_URL must use the origin root without a query or fragment');
  }
  return url.href;
}

export function requireRepositoryUrl(raw: string | undefined): string {
  const url = new URL(requireAbsoluteHttpUrl(raw, 'VITE_RIFTY_REPOSITORY_URL'));
  if (url.pathname === '/') {
    throw new Error('VITE_RIFTY_REPOSITORY_URL must identify a repository path');
  }
  if (url.search || url.hash) {
    throw new Error('VITE_RIFTY_REPOSITORY_URL must not contain a query or fragment');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}
