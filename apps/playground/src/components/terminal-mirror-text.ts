const ESC = String.fromCharCode(27);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');

/** Plain searchable text for the hidden terminal mirror, not an ANSI replay. */
export function terminalMirrorText(serialized: string): string {
  return serialized.replace(ANSI_CSI, '');
}
