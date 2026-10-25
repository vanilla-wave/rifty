import { render } from 'solid-js/web';
import {
  PlaygroundHealthBanner,
  createPlaygroundHealthUi,
} from '../../../apps/playground/src/adapters/playground-health-ui.tsx';
import { health } from './legacy-layout-workbench.ts';
export function mount() {
  const ui = createPlaygroundHealthUi();
  ui.bindWorkbench(health());
  const root = document.createElement('div');
  document.body.append(root);
  const dispose = render(
    () => (
      <PlaygroundHealthBanner
        boot={ui.boot}
        issues={ui.issues}
        onRetry={() => {
          throw Error('Unexpected boot retry');
        }}
        onRecover={(scope) => {
          void ui.recover(scope);
        }}
        onReload={() => location.reload()}
      />
    ),
    root,
  );
  return () => {
    dispose();
    ui.dispose();
    root.remove();
  };
}
