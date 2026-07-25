export interface AddressInfo {
  readonly address: string;
  readonly family: 'IPv4' | 'IPv6';
  readonly port: number;
}

/**
 * The port registry is host-agnostic and exposes one effective loopback
 * endpoint. Requested listen hosts are deliberately ignored (ADR-0054).
 */
export function createVirtualAddressInfo(port: number): AddressInfo {
  return {
    address: '127.0.0.1',
    family: 'IPv4',
    port,
  };
}
