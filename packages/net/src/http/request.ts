/**
 * `IncomingMessage` types for server-side request handlers and client-side
 * response objects (`http.request`). Both wrap a fetch `Request`/`Response`
 * into a Node-shape `Readable`.
 */

import { Readable } from '@rifty/runtime-js/builtins';

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  socket = {};
  constructor(request: Request) {
    super({ objectMode: false });
    const u = new URL(request.url);
    this.method = request.method;
    this.url = u.pathname + u.search;
    this.headers = Object.fromEntries(request.headers);
    void this.populate(request);
  }
  private async populate(request: Request): Promise<void> {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) this.push(new Uint8Array(body));
    this.push(null);
  }
}

export class IncomingMessageFromFetch extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  constructor(response: Response) {
    super({ objectMode: false });
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    this.headers = Object.fromEntries(response.headers);
    void this.populate(response);
  }
  private async populate(response: Response): Promise<void> {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > 0) this.push(buf);
    this.push(null);
  }
}
