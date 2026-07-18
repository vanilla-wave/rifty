/** Dependency-free data home used by catalog validation without an index cycle. */
export interface OverrideMap {
  [key: string]: string;
}

export const bakedOverrides: OverrideMap = {
  bcrypt: 'bcryptjs',
  esbuild: '@esbuild/wasi-preview1@0.28.0',
  lightningcss: 'lightningcss-wasm@1.32.0',
};
