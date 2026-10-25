import type { ImageContent } from '@riftydev/agent';
import type { ProjectFiles } from '@riftydev/workbench';

export type ChatAttachment = { readonly name: string } & (
  | { readonly image: ImageContent; readonly path?: never }
  | { readonly path: string; readonly image?: never }
);

export async function attachFile(files: ProjectFiles, file: File): Promise<ChatAttachment> {
  if (file.type.startsWith('image/')) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${file.name}`));
      reader.onload = () => {
        if (typeof reader.result !== 'string')
          reject(new Error(`Invalid image data: ${file.name}`));
        else resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      };
      reader.readAsDataURL(file);
    });
    return { name: file.name, image: { type: 'image', mimeType: file.type, data } };
  }
  if (!(await files.readdir('/')).some((entry) => entry.path === '/attachments'))
    await files.mkdir('/attachments', { expectedVersion: null });
  const entries = await files.readdir('/attachments');
  const leaf = file.name.split(/[\\/]/).at(-1)?.replaceAll('\0', '_');
  const name = !leaf || leaf === '.' || leaf === '..' ? 'attachment' : leaf;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let path = `/attachments/${name}`;
  for (let index = 2; entries.some((entry) => entry.path === path); index++)
    path = `/attachments/${stem}-${index}${extension}`;
  await files.writeFile(path, new Uint8Array(await file.arrayBuffer()), { expectedVersion: null });
  return { name: file.name, path };
}
