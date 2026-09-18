import type { AgentResourceReport } from '@riftydev/agent';
import { For, Show } from 'solid-js';

export function ResourceReport(props: { report: AgentResourceReport; reloaded: boolean }) {
  return (
    <details class="rf-ai__resources" data-testid="ai-resources" open>
      <summary>{props.reloaded ? 'Reloaded' : 'Loaded'} project resources</summary>
      <div>
        <Show
          when={props.report.contextFiles.length || props.report.skills.length}
          fallback={<p>No context files or skills loaded.</p>}
        >
          <ul>
            <For each={props.report.contextFiles}>{(file) => <li>{file.path}</li>}</For>
            <For each={props.report.skills}>
              {(skill) => (
                <li>
                  {skill.name} — {skill.filePath}
                  {skill.disableModelInvocation ? ' (hidden from model)' : ''}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <For each={props.report.unsupported}>
          {(resource) => <p>Unsupported: {resource.path}</p>}
        </For>
        <For each={props.report.diagnostics}>
          {(diagnostic) => (
            <p>
              {diagnostic.type}: {diagnostic.path} — {diagnostic.message}
            </p>
          )}
        </For>
      </div>
    </details>
  );
}
