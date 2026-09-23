export interface ProxyProvenanceAuthority {
  readonly Proxy: ProxyConstructor;
  readonly targetCloneFailure: (target: object) => string;
  readonly cloneFailure: (value: object) => string | undefined;
  readonly markGuestProxy: (wrapper: object, failure: () => string) => void;
}

export interface ProxyProvenanceOwner {
  readonly acquireDuringBootstrap: () => ProxyProvenanceAuthority;
  readonly install: () => void;
  readonly sealBootstrap: () => void;
}
