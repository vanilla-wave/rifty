/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RIFTY_PLAYGROUND_URL: string;
  readonly VITE_RIFTY_REPOSITORY_URL: string;
  readonly VITE_RIFTY_SDK_DOCS_URL: string;
  readonly VITE_RIFTY_SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
