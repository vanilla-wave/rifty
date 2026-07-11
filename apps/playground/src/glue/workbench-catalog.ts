import { type WorkbenchProjectCatalog, validateProjectCatalog } from '@riftydev/workbench';
import { DEFAULT_PRESET, PRESETS } from '../presets.ts';
import { DEFAULT_TEMPLATE_ID, allProjectSpecs } from '../templates/registry.ts';

/** Serializable catalog injected into every package-owned worker realm. */
export const PLAYGROUND_PROJECT_CATALOG: WorkbenchProjectCatalog = validateProjectCatalog({
  defaultTemplateId: DEFAULT_TEMPLATE_ID,
  defaultStarterId: DEFAULT_PRESET.id,
  templates: allProjectSpecs(),
  starters: PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.label,
    templateId: preset.templateId ?? DEFAULT_TEMPLATE_ID,
    files: preset.files,
  })),
});
