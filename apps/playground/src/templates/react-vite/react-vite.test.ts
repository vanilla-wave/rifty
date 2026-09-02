/**
 * Portability contract for the react-vite template (backlog:
 * playground/react-vite-starter): the seeded tree must be an ordinary,
 * self-sufficient npm project — the same files run under a local
 * `npm install` + Vite 7 — with zero sandbox-specific code or config.
 */
import { describe, expect, it } from 'vitest';
import { buildProjectPackageJson, isDevScriptName } from '../project-spec.ts';
import { REACT_VITE_TEMPLATE } from './index.ts';

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
    // every script is a plain vite command — nothing sandbox-flavored
    for (const body of Object.values(pkg.scripts)) {
      expect(body).toMatch(/^vite(?: |$)/u);
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

  it('keeps build/preview OUT of the dev aliases — `npm run build` must not boot the dev server', () => {
    expect(isDevScriptName(REACT_VITE_TEMPLATE, 'dev')).toBe(true);
    expect(isDevScriptName(REACT_VITE_TEMPLATE, 'vite')).toBe(true);
    expect(isDevScriptName(REACT_VITE_TEMPLATE, 'build')).toBe(false);
    expect(isDevScriptName(REACT_VITE_TEMPLATE, 'preview')).toBe(false);
  });

  it('contains zero sandbox-specific references in any template file', () => {
    const files = allFiles();
    for (const [path, content] of Object.entries(files)) {
      expect(content, `${path} must not reference __rifty`).not.toContain('__rifty');
      expect(content, `${path} must not reference /preview/`).not.toContain('/preview/');
      expect(content, `${path} must not name the host sandbox`).not.toMatch(/rifty/iu);
    }
    // the generated package.json carries the rifty-<id>-app NAME (cosmetic,
    // shared across templates) but no sandbox-specific script/config
    const pkgJson = buildProjectPackageJson(REACT_VITE_TEMPLATE).json;
    expect(pkgJson).not.toContain('__rifty');
    expect(pkgJson).not.toContain('/preview/');
  });

  it('forms a self-sufficient npm project (index.html + tsconfig + vite config + entry)', () => {
    const files = allFiles();
    expect(files['/index.html']).toContain('src="/src/main.tsx"');
    expect(files['/index.html']).toContain('id="root"');
    expect(files['/tsconfig.json']).toContain('"jsx": "react-jsx"');
    expect(files['/vite.config.ts']).toContain('@vitejs/plugin-react');
    // the optimizer stays ON: CJS react/react-dom must be pre-bundled
    expect(files['/vite.config.ts']).not.toContain('noDiscovery');
    expect(REACT_VITE_TEMPLATE.entry.relativePath).toBe('/src/main.tsx');
    expect(files['/src/main.tsx']).toContain('createRoot');
    expect(REACT_VITE_TEMPLATE.bakedNodeModulesUrl).toBeUndefined();
  });

  it('ships the issue-tracker dataset the dashboard/filters need (25 issues, 4 statuses, 5 assignees)', () => {
    const data = REACT_VITE_TEMPLATE.extraFiles?.['/src/data/issues.ts'];
    expect(data).toBeDefined();
    const issueIds = data?.match(/^ {4}id: \d+,$/gmu) ?? [];
    expect(issueIds).toHaveLength(25);
    expect(data).toContain("statuses: Status[] = ['open', 'in-progress', 'resolved', 'closed']");
    expect(data).toContain("assignees = ['Mara', 'Deniz', 'Kofi', 'Priya', 'Tomas']");
  });

  it('documents the four planted rough edges in the seeded README', () => {
    const readme = REACT_VITE_TEMPLATE.extraFiles?.['/README.md'] ?? '';
    expect(readme.match(/^\d+\. \*\*/gmu) ?? []).toHaveLength(4);
    // each edge names the file that carries it, or the missing capability
    expect(readme).toContain('src/pages/Dashboard.tsx');
    expect(readme).toContain('src/pages/IssueList.tsx');
    expect(readme).toMatch(/URL/u);
    expect(readme).toMatch(/new-issue/u);
    // the dataset really carries the planted unpadded dates edge #1 relies on
    const data = REACT_VITE_TEMPLATE.extraFiles?.['/src/data/issues.ts'] ?? '';
    expect(data).toMatch(/createdAt: '2025-9-14'/u);
  });
});
