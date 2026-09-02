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
    // exact ranges: the contract pins Vite ^7 + plugin-react 5 (Fast Refresh
    // evidence exists only there — Vite 8 HMR stays disabled, ADR-0161/0317)
    expect(pkg.devDependencies).toEqual({
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@vitejs/plugin-react': '^5.0.0',
      typescript: '^5.0.0',
      vite: '^7.0.0',
    });
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

  it('keeps the four rough edges planted in the code — fixing one must fail here', () => {
    const files = allFiles();
    const dashboard = files['/src/pages/Dashboard.tsx'] ?? '';
    const list = files['/src/pages/IssueList.tsx'] ?? '';
    // component/page code only — the dataset's prose may say "new issue"
    const code = Object.entries(files).filter(
      ([path]) => path.startsWith('/src/pages/') || path.startsWith('/src/components/'),
    );
    // #1 text sort on createdAt (no date parsing)
    expect(dashboard).toMatch(/a\.createdAt > b\.createdAt/u);
    expect(dashboard).not.toMatch(/new Date\(|Date\.parse|localeCompare/u);
    // #2 no search box
    expect(list).not.toMatch(/<input|search/iu);
    // #3 filters live in component state only, never in the URL
    expect(list).toMatch(/useState\('all'\)/u);
    expect(list).not.toMatch(/useSearchParams|URLSearchParams|useLocation|useNavigate/u);
    // #4 no way to file an issue: no form outside Settings, no issue creation
    for (const [path, content] of code) {
      if (path !== '/src/pages/Settings.tsx') expect(content, path).not.toContain('<form');
      expect(content, path).not.toMatch(/NewIssue|createIssue|issues\.push\(/u);
    }
  });
});
