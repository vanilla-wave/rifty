import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { agentModelServer } from '../../../../tests/e2e/fixtures/agent-model-server.ts';

const root = await mkdtemp('/tmp/pr333-cli-public-extension-');
const cli = new URL(
  '../../../../tools/agent-bench/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
  import.meta.url,
).pathname;
const results = [];
for (const scenario of ['tools', 'time']) {
  const sentinel = true;
  const project = `${root}/${scenario}`;
  const cliHome = `${project}/pi-home`;
  await mkdir(cliHome, { recursive: true });
  await writeFile(`${project}/package.json`, '{"name":"native-cli-probe","version":"1.0.0"}');
  const server = await agentModelServer(
    scenario === 'tools'
      ? [
          [{ name: 'write', args: { path: 'admitted.txt', content: 'one' } }],
          [{ name: 'write', args: { path: 'blocked.txt', content: 'two' } }],
          'Unexpected continued.',
        ]
      : [
          [
            {
              name: 'bash',
              args: {
                command: `node -e "require('fs').writeFileSync('active-pid.txt',String(process.pid)); console.log('NATIVE_STARTED'); setTimeout(()=>{},30000)"`,
              },
            },
          ],
          'Unexpected continued.',
        ],
  );
  const extension = `${project}/probe.ts`;
  await writeFile(
    extension,
    `import {writeFileSync} from 'node:fs'; export default function(pi) { let calls=0; let deadline; pi.on('agent_start', (_event,ctx) => { if (${JSON.stringify(scenario)} === 'time') deadline=setTimeout(() => {writeFileSync(${JSON.stringify(`${project}/budget.json`)},JSON.stringify({kind:'time',calls}));ctx.abort();},1000); }); pi.on('agent_end', () => clearTimeout(deadline)); pi.on('before_provider_headers', event => { event.headers.Authorization=null; }); pi.on('before_agent_start', event => {writeFileSync(${JSON.stringify(`${project}/system-prompt.txt`)},event.systemPrompt);}); pi.on('tool_call', (event,ctx) => { if(calls>=1) { writeFileSync(${JSON.stringify(`${project}/budget.json`)},JSON.stringify({calls,blocked:event.toolName})); ctx.abort(); return {block:true,reason:'Native probe tool budget',terminate:true}; } calls++; }); }`,
  );
  try {
    await writeFile(
      `${cliHome}/models.json`,
      JSON.stringify({
        providers: {
          bench: {
            baseUrl: server.baseUrl,
            api: 'openai-completions',
            authHeader: false,
            ...(sentinel ? { apiKey: 'bench-probe-sentinel' } : {}),
            models: [
              {
                id: 'scripted',
                name: 'scripted',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
              },
            ],
          },
        },
      }),
    );
    const child = spawn(
      process.execPath,
      [
        cli,
        '--provider',
        'bench',
        '--model',
        'scripted',
        '--mode',
        'json',
        '--no-session',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '-e',
        extension,
        '-p',
        'Write the two probe files.',
      ],
      {
        cwd: project,
        env: { ...process.env, PI_CODING_AGENT_DIR: cliHome, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    clearTimeout(timer);
    await writeFile(`${project}/events.jsonl`, stdout);
    await writeFile(`${project}/stderr.log`, stderr);
    let activeProgramStopped = null;
    if (scenario === 'time') {
      const pid = Number(await readFile(`${project}/active-pid.txt`, 'utf8'));
      try {
        process.kill(pid, 0);
        activeProgramStopped = false;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        activeProgramStopped = true;
      }
    }
    results.push({
      scenario,
      activeProgramStopped,
      sentinel,
      exitCode,
      admitted: await readFile(`${project}/admitted.txt`, 'utf8').catch(() => null),
      blockedExists: await access(`${project}/blocked.txt`).then(
        () => true,
        () => false,
      ),
      budget: await readFile(`${project}/budget.json`, 'utf8').catch(() => null),
      requests: server.requests.map((request) => ({
        authorization:
          request.authorization === null
            ? 'absent'
            : request.authorization === 'Bearer bench-probe-sentinel'
              ? 'synthetic'
              : 'present (redacted)',
        tools: request.body.tools.map((tool) => tool.function.name),
      })),
      stderr,
      events: stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            const event = JSON.parse(line);
            return {
              type: event.type,
              stopReason: event.message?.stopReason,
              errorMessage: event.message?.errorMessage,
            };
          } catch {
            return { nonJson: true };
          }
        }),
    });
  } finally {
    await server.close();
  }
}
await writeFile(`${root}/result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ root, results }, null, 2));
