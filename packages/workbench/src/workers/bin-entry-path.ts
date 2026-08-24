/** A resolved entry is an npm launcher only inside a `node_modules/.bin` directory. */
export function isBinShimPath(path: string): boolean {
  return path.includes('/node_modules/.bin/');
}
