import { requireAbsoluteHttpUrl, requireRepositoryUrl } from './configured-url';

export const repositoryUrl = requireRepositoryUrl(import.meta.env.VITE_RIFTY_REPOSITORY_URL);
export const sdkDocsUrl = requireAbsoluteHttpUrl(
  import.meta.env.VITE_RIFTY_SDK_DOCS_URL,
  'VITE_RIFTY_SDK_DOCS_URL',
);
