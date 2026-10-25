export function projectFileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || 'project';
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}
