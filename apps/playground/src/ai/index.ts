/**
 * AI mode entry (ADR-0190) — loaded via dynamic `import()` from App.tsx only
 * when AI mode is first opened, so a session that never opens it downloads
 * none of the Pi/agent code (the backlog item's lazy-loading acceptance).
 */
export { AiChatPanel } from './AiChatPanel.tsx';
export type { AiAppContext } from './app-context.ts';
