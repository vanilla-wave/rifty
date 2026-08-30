import type { Server } from 'node:http';

export declare function startNoCoiServer(
  port: number,
  opts?: { inject?: { header?: 'coop' | 'coep'; status?: number; path: string } },
): Promise<Server>;
