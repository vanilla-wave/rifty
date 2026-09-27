import { For, Show, createEffect, createSignal } from 'solid-js';
import { type ChatModel, type ChatSettings, newModel, readCatalog } from './settings.ts';

export function CatalogSettings(props: {
  value: ChatSettings;
  disabled: boolean;
  onChange: (value: ChatSettings) => void;
  onApply: (event: SubmitEvent) => void;
}) {
  const [catalogText, setCatalogText] = createSignal(JSON.stringify(props.value.models, null, 2));
  const [error, setError] = createSignal('');
  createEffect(() => {
    const models = props.value.models;
    if (!error()) setCatalogText(JSON.stringify(models, null, 2));
  });
  const selected = () =>
    props.value.models.find((model) => model.id === props.value.model) ?? props.value.models[0]!;
  function changeModel<K extends keyof ChatModel>(field: K, value: ChatModel[K]) {
    const current = selected();
    const next = { ...current, [field]: value };
    if (field === 'id' && (!current.name || current.name === current.id)) next.name = String(value);
    props.onChange({
      ...props.value,
      models: props.value.models.map((model) => (model === current ? next : model)),
      model: next.id,
    });
  }
  function editJson(text: string) {
    setCatalogText(text);
    try {
      const models = readCatalog(JSON.parse(text));
      setError('');
      props.onChange({
        ...props.value,
        models,
        model: models.some((model) => model.id === props.value.model)
          ? props.value.model
          : models[0]!.id,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  function addModel() {
    let index = props.value.models.length + 1;
    while (props.value.models.some((model) => model.id === `model-${index}`)) index++;
    const model = newModel(`model-${index}`, selected().baseUrl);
    setError('');
    props.onChange({ ...props.value, models: [...props.value.models, model], model: model.id });
  }
  return (
    <form
      class="rf-ai__settings"
      onSubmit={(event) => {
        if (error()) event.preventDefault();
        else props.onApply(event);
      }}
    >
      <fieldset disabled={props.disabled}>
        <label>
          Edit model
          <select
            aria-label="Edit model"
            value={props.value.model}
            onChange={(event) =>
              props.onChange({ ...props.value, model: event.currentTarget.value })
            }
          >
            <For each={props.value.models}>
              {(model) => <option value={model.id}>{model.name || model.id || 'New model'}</option>}
            </For>
          </select>
        </label>
        <button type="button" class="rf-btn rf-btn--ghost" onClick={addModel}>
          Add model
        </button>
        <label>
          Base URL
          <input
            value={selected().baseUrl}
            onInput={(event) => changeModel('baseUrl', event.currentTarget.value)}
            placeholder="/ai-proxy/v1"
            required
          />
        </label>
        <label>
          Model
          <input
            value={selected().id}
            onInput={(event) => changeModel('id', event.currentTarget.value)}
            required
          />
        </label>
        <label>
          API key (optional)
          <input
            type="password"
            autocomplete="off"
            value={props.value.apiKeys[selected().provider] ?? ''}
            onInput={(event) =>
              props.onChange({
                ...props.value,
                apiKeys: {
                  ...props.value.apiKeys,
                  [selected().provider]: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <small>
          Catalog and selection are saved. Keys, headers and run limits stay in this chat.
        </small>
        <details>
          <summary>Advanced catalog</summary>
          <label>
            Model catalog (JSON)
            <textarea
              rows={10}
              value={catalogText()}
              onInput={(event) => editJson(event.currentTarget.value)}
              spellcheck={false}
            />
          </label>
          <small>
            Native model fields; thinking, temperature and samplingParams set request defaults. The
            browser uses OpenAI-compatible transport.
          </small>
        </details>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
        <div class="rf-ai__limits">
          <label>
            Tool limit
            <input
              type="number"
              min="1"
              step="1"
              value={props.value.maxToolCalls}
              onInput={(event) =>
                props.onChange({ ...props.value, maxToolCalls: Number(event.currentTarget.value) })
              }
              required
            />
          </label>
          <label>
            Time limit (seconds)
            <input
              type="number"
              min="1"
              step="1"
              value={props.value.runTimeoutMs / 1000}
              onInput={(event) =>
                props.onChange({
                  ...props.value,
                  runTimeoutMs: Number(event.currentTarget.value) * 1000,
                })
              }
              required
            />
          </label>
        </div>
        <button type="submit" class="rf-btn" disabled={Boolean(error())}>
          Apply and reset chat
        </button>
      </fieldset>
    </form>
  );
}
