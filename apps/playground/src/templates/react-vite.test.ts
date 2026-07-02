/**
 * Portability contract for the react-vite template (backlog:
 * playground/react-vite-preset): the template source must be an ordinary,
 * self-sufficient npm project — `npm install && npm run dev` on local Node
 * serves the identical app — with zero rifty-specific code or config.
 */
import { describe, expect, it } from 'vitest';
import { buildProjectPackageJson } from './project-spec.ts';
import { REACT_VITE_TEMPLATE } from './react-vite.ts';

function allFiles(): Record<string, string> {
  return {
    [REACT_VITE_TEMPLATE.entry.relativePath]: REACT_VITE_TEMPLATE.entry.content,
    ...REACT_VITE_TEMPLATE.extraFiles,
  };
}

describe('react-vite template portability', () => {
  it('seeds a package.json with standard portable scripts (dev/build/preview = plain vite)', () => {
    const pkg = JSON.parse(buildProjectPackageJson(REACT_VITE_TEMPLATE).json) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts.build).toBe('vite build');
    expect(pkg.scripts.preview).toBe('vite preview');
    // every script is a plain vite command — nothing rifty-flavored
    for (const body of Object.values(pkg.scripts)) {
      expect(body).toMatch(/^vite(?: |$)/);
    }
    expect(pkg.dependencies).toEqual({
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'react-router-dom': '^7.0.0',
    });
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining([
        '@types/react',
        '@types/react-dom',
        '@vitejs/plugin-react',
        'typescript',
        'vite',
      ]),
    );
  });

  it('contains zero rifty-specific references in any template file', () => {
    const files = allFiles();
    for (const [path, content] of Object.entries(files)) {
      expect(content, `${path} must not reference __rifty`).not.toContain('__rifty');
      expect(content, `${path} must not reference /preview/`).not.toContain('/preview/');
      expect(content, `${path} must not reference rifty`).not.toMatch(/rifty/iu);
    }
    // the generated package.json carries the rifty-<id>-app NAME (cosmetic,
    // shared across templates) but no rifty-specific script/config
    const pkgJson = buildProjectPackageJson(REACT_VITE_TEMPLATE).json;
    expect(pkgJson).not.toContain('__rifty');
    expect(pkgJson).not.toContain('/preview/');
  });

  it('forms a self-sufficient npm project (index.html + tsconfig + vite config + entry)', () => {
    const files = allFiles();
    expect(files['/index.html']).toContain('src="/src/main.tsx"');
    expect(files['/tsconfig.json']).toContain('"jsx": "react-jsx"');
    expect(files['/vite.config.ts']).toContain('@vitejs/plugin-react');
    expect(REACT_VITE_TEMPLATE.entry.relativePath).toBe('/src/main.tsx');
    expect(files['/src/main.tsx']).toContain('createRoot');
  });

  it('ships the issue-tracker dataset the dashboard/filters need (25 issues, 4 statuses, 5 assignees)', () => {
    const data = REACT_VITE_TEMPLATE.extraFiles['/src/data/issues.ts'];
    expect(data).toBeDefined();
    const issueIds = data?.match(/^ {4}id: \d+,$/gmu) ?? [];
    expect(issueIds).toHaveLength(25);
    expect(data).toContain("statuses: Status[] = ['open', 'in-progress', 'resolved', 'closed']");
    expect(data).toContain("assignees = ['Mara', 'Deniz', 'Kofi', 'Priya', 'Tomas']");
  });
});
