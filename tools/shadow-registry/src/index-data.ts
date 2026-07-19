/** Dependency-free data home used by catalog validation without an index cycle. */
export interface OverrideMap {
  [key: string]: string;
}

export const bakedOverrides: OverrideMap = {
  bcrypt: 'bcryptjs',
  lightningcss: 'lightningcss-wasm@1.32.0',
};
