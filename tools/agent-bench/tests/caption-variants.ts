import assert from 'node:assert/strict';
import type { FileTree } from '../src/files.ts';
import type { Task } from '../src/tasks.ts';
export function captionReference(task: Task): FileTree {
  assert(['contact-import', 'linked-knowledge'].includes(task.family!));
  const reference = task.controls!.reference!;
  const sourcePath = task.family === 'contact-import' ? 'src/main.tsx' : 'src/main.js';
  const original = reference[sourcePath]!;
  const source =
    task.family === 'contact-import'
      ? original
          .replace('CSV data<textarea', 'Paste CSV content with name,email header<textarea')
          .replace('>Import</button>', '>Import CSV</button>')
          .replace('>Save</button>', '>Save changes</button>')
          .replace('<label>Name ', '<label>Contact name ')
          .replace('<label>Email ', '<label>Contact email ')
          .replace('Filter<input', 'Filter contacts by name and email<input')
          .replace('>Export</button>', '>Export filtered CSV</button>')
          .replace('Exported CSV<textarea', 'Filtered CSV output<textarea')
      : original
          .replace('>Title<input', '>Note name<input')
          .replace('>Markdown<textarea', '>Note body<textarea')
          .replace('>Search<input', '>Find notes by name and body<input')
          .replace('>Save</button>', '>Save note</button>')
          .replace('>Delete</button>', '>Delete note</button>')
          .replace('>${escape(note.title)}</button>', '>Open ${escape(note.title)}</button>');
  assert.notEqual(source, original);
  return { ...reference, [sourcePath]: source };
}
