import type { Server } from 'node:http';

export declare function startNoCoiServer(
  port: number,
  opts?: { inject?: { header: 'coop' | 'coep'; path: string } },
): Promise<Server>;
