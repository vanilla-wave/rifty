import { render } from 'solid-js/web';
import { bindPlaygroundEditorOwner } from '../../../apps/playground/src/adapters/playground-editor-owner.ts';
import {
  createPlaygroundDocumentWriter,
  createPlaygroundProjectMirror,
} from '../../../apps/playground/src/adapters/playground-project-view.ts';
import { type EditorApi, EditorHost } from '../../../apps/playground/src/components/EditorHost.tsx';
import { currentProject } from './sealed-playground-workbench.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function mounted() {
  const project = currentProject();
  for (const path of ['/live.ts', '/closed.ts'])
    await project.files.writeFile(path, encoder.encode('export const value = "before";'), {
      expectedVersion: null,
    });
  const mirror = createPlaygroundProjectMirror(project.files);
  const documents = createPlaygroundDocumentWriter(project.documents);
  for (const path of ['/live.ts', '/closed.ts']) mirror.admitFile(await documents.open(path));
  const container = document.createElement('div');
  container.style.cssText = 'width:900px;height:500px;display:grid';
  document.body.append(container);
  let api!: EditorApi;
  let ready!: () => void;
  const available = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let live = true;
  let detach = () => {};
  let writes = 0;
  const errors: string[] = [];
  const dispose = render(
    () => (
      <EditorHost
        initialEditorFiles={() => ['/live.ts']}
        root={() => '/'}
        vfs={mirror}
        onActive={() => {}}
        onError={(message) => errors.push(message)}
        onFileWritten={(path, text) => {
          writes++;
          return documents.write(path, text);
        }}
        registerApi={(selected) => {
          api = selected;
          detach = bindPlaygroundEditorOwner({
            api,
            files: project.files,
            mirror,
            documents,
            isCurrent: () => live,
            onDocument: () => {},
            onError: (message) => errors.push(message),
          });
          ready();
        }}
      />
    ),
    container,
  );
  await available;
  api.openFile('/live.ts');
  const model = (path: string) => {
    const current = api.monaco.editor
      .getModels()
      .find((candidate) => api.pathForModel(candidate) === path);
    if (!current) throw new Error(`Missing real Monaco model ${path}`);
    return current;
  };
  return {
    project,
    mirror,
    documents,
    api,
    model,
    errors,
    writes: () => writes,
    close() {
      live = false;
      detach();
      dispose();
      mirror.dispose();
      container.remove();
    },
  };
}

async function until(test: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!test()) {
    if (performance.now() > deadline) throw new Error('Owner bytes never reached the real editor');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function cleanOwnerUpdate() {
  const h = await mounted();
  try {
    const originalModel = h.model('/live.ts');
    const before = await h.project.files.readFile('/live.ts');
    await h.project.files.writeFile('/live.ts', encoder.encode('export const value = "remote";'), {
      expectedVersion: before.version,
    });
    const written = await h.project.files.readFile('/live.ts');
    await until(() => h.model('/live.ts').getValue().includes('remote'));
    await h.api.flushPendingWrites();
    const afterRefresh = await h.project.files.readFile('/live.ts');
    const echoWrites = h.writes();
    h.model('/live.ts').setValue('export const value = "local-after-refresh";');
    await h.api.flushPendingWrites();
    const saved = await h.project.files.readFile('/live.ts');

    const closed = await h.project.files.readFile('/closed.ts');
    await h.project.files.writeFile(
      '/closed.ts',
      encoder.encode('export const closed = "remote-closed";'),
      { expectedVersion: closed.version },
    );
    h.mirror.admitFile(await h.documents.open('/closed.ts', { fresh: true }));
    h.api.openFile('/closed.ts');
    return {
      sameModel: originalModel === h.model('/live.ts'),
      echoWrites,
      versionStable: written.version === afterRefresh.version,
      saved: decoder.decode(saved.bytes),
      closed: h.model('/closed.ts').getValue(),
      errors: h.errors,
    };
  } finally {
    h.close();
  }
}

export async function pendingLocalUpdate() {
  const h = await mounted();
  try {
    const before = await h.project.files.readFile('/live.ts');
    h.model('/live.ts').setValue('export const value = "unpublished-local";');
    await h.project.files.writeFile(
      '/live.ts',
      encoder.encode('export const value = "external-winner";'),
      { expectedVersion: before.version },
    );
    const failure = await h.api.flushPendingWrites().then(
      () => null,
      (error: Error) => error.message,
    );
    const owner = await h.project.files.readFile('/live.ts');
    const captured = await h.documents.open('/live.ts');
    return {
      failure,
      owner: decoder.decode(owner.bytes),
      model: h.model('/live.ts').getValue(),
      dirty: captured.dirty,
      oldBase: captured.version === before.version,
    };
  } finally {
    h.close();
  }
}
