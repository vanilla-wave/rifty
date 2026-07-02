/**
 * Lane `rifty` — playground + built-in AI mode through the real chat UI
 * (Playwright typing, `?agentBench=1` hooks for seed/trace only).
 *
 * NOT YET WIRED: this is pass B of the item — it lands together with the
 * `distribution/ai-mode-playground` hooks (`globalThis.__riftyAgentBench`).
 * Until then every entry point refuses loudly; there is deliberately no stub
 * result path here.
 */
import { NotImplementedError } from '../errors.ts';
import type { BenchTask } from '../tasks.ts';
import type { LaneAdapter, PreparedRun } from './types.ts';

export const RIFTY_LANE_NOT_WIRED =
  "agent-bench: lane 'rifty' is not wired yet — it is pass B of " +
  'docs/backlog/distribution/agent-bench-harness.md and lands with the ' +
  '`distribution/ai-mode-playground` hooks (?agentBench=1 + __riftyAgentBench). ' +
  'Run --lane local-reference for now.';

export function createRiftyLane(): LaneAdapter {
  return {
    id: 'rifty',
    promptProfile: 'pi-baseline+rifty-adapter-v1',
    async laneVersions(): Promise<Record<string, string>> {
      throw new NotImplementedError('agent-bench.lane.rifty', RIFTY_LANE_NOT_WIRED);
    },
    async prepare(_task: BenchTask, _runDir: string): Promise<PreparedRun> {
      throw new NotImplementedError('agent-bench.lane.rifty', RIFTY_LANE_NOT_WIRED);
    },
  };
}
