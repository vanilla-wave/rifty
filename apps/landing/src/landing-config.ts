import { requireAbsoluteHttpUrl, requireRepositoryUrl, requireSiteBaseUrl } from './configured-url';
import { buildPlaygroundHref } from './playground-url';

export const repositoryUrl = requireRepositoryUrl(import.meta.env.VITE_RIFTY_REPOSITORY_URL);
export const sdkDocsUrl = requireAbsoluteHttpUrl(
  import.meta.env.VITE_RIFTY_SDK_DOCS_URL,
  'VITE_RIFTY_SDK_DOCS_URL',
);
export const siteUrl = requireSiteBaseUrl(import.meta.env.VITE_RIFTY_SITE_URL);
export const playgroundHref = buildPlaygroundHref(import.meta.env.VITE_RIFTY_PLAYGROUND_URL);

/** Upper-case host of an absolute deployment URL; a root-relative mount has no host to show. */
export function hostLabel(href: string, fallback: string): string {
  return /^https?:\/\//i.test(href) ? new URL(href).host.toUpperCase() : fallback;
}

export const playgroundLabel = hostLabel(playgroundHref, 'PLAYGROUND');
export const siteLabel = hostLabel(siteUrl, 'RIFTY');

/** Public release stamp: the latest published `@riftydev/*` minor + the active roadmap milestone. */
export const RELEASE_STAMP = 'v0.4';
export const MILESTONE_STAMP = 'M11 ACTIVE';
/** Spelled-out form for the hero eyebrow; the status token is what keeps it honest. */
export const MILESTONE_LONG = 'M11 CONSUMER READY: ACTIVE';
