/**
 * `args_*` and `environ_*` syscalls. Stateless w.r.t. mutation — they read
 * the immutable `args`/`env` arrays in the context.
 */
import { E_SUCCESS, type WasiCtx, enc } from './shared.ts';

export function envSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    args_get: (argv: number, argvBuf: number) => {
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = argvBuf;
      for (let i = 0; i < ctx.args.length; i++) {
        view.setUint32(argv + i * 4, off, true);
        const b = enc.encode(`${ctx.args[i] ?? ''}\0`);
        bytes.set(b, off);
        off += b.length;
      }
      return E_SUCCESS;
    },
    args_sizes_get: (countOut: number, sizeOut: number) => {
      const view = ctx.view();
      view.setUint32(countOut, ctx.args.length, true);
      let size = 0;
      for (const a of ctx.args) size += enc.encode(`${a}\0`).length;
      view.setUint32(sizeOut, size, true);
      return E_SUCCESS;
    },
    environ_get: (envPtr: number, envBuf: number) => {
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = envBuf;
      let idx = 0;
      for (const k of Object.keys(ctx.env)) {
        view.setUint32(envPtr + idx * 4, off, true);
        const b = enc.encode(`${k}=${ctx.env[k]}\0`);
        bytes.set(b, off);
        off += b.length;
        idx++;
      }
      return E_SUCCESS;
    },
    environ_sizes_get: (countOut: number, sizeOut: number) => {
      const view = ctx.view();
      const keys = Object.keys(ctx.env);
      view.setUint32(countOut, keys.length, true);
      let size = 0;
      for (const k of keys) size += enc.encode(`${k}=${ctx.env[k]}\0`).length;
      view.setUint32(sizeOut, size, true);
      return E_SUCCESS;
    },
  };
}
