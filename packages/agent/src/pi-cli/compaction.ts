// Ported from pi-coding-agent 1.6.0 src/core/compaction/{compaction,utils}.ts and the
// projection half of src/core/session-manager.ts (MIT, see ../../THIRD_PARTY_NOTICES.md).
// Upstream exports no browser-safe compaction (ADR-0569). Scope: the journal entries rifty
// writes (message, compaction, omission edit) on one linear branch; no extension hooks,
// branch summaries or codemode calls. Differential suite:
// tools/agent-bench/src/continuation-parity.test.ts against the real CLI.
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Message,
  type RetryCallbacks,
  type RetryPolicy,
  type SimpleStreamOptions,
  type SystemMessage,
  type TranscriptContext,
  type Usage,
  contentText,
  getCurrentSystemMessage,
  normalizeContext,
  retryAssistantCall,
  uuidv7,
} from '@earendil-works/pi-ai';
import { convertToLlm, createCompactionSummaryMessage } from './messages.ts';

interface EntryBase {
  id: string;
  timestamp: string;
}
export interface MessageEntry extends EntryBase {
  type: 'message';
  message: AgentMessage;
}
export interface CompactionEntry extends EntryBase {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  systemMessage?: SystemMessage;
}
/** CLI recovery omission: `appendContextEdit(targetId, null)`. */
export interface OmissionEntry extends EntryBase {
  type: 'context_edit';
  targetId: string;
  replacement: null;
}
export type Entry = MessageEntry | CompactionEntry | OmissionEntry;

interface ProjectedEntry {
  sourceEntry: Entry;
  messages: AgentMessage[];
}
interface Projection {
  entries: ProjectedEntry[];
  messages: AgentMessage[];
}

export function entryToContextMessages(entry: Entry): AgentMessage[] {
  if (entry.type === 'message') return [entry.message];
  if (entry.type === 'compaction') {
    const summary = createCompactionSummaryMessage(
      entry.summary,
      entry.tokensBefore,
      entry.timestamp,
    );
    return entry.systemMessage ? [entry.systemMessage, summary] : [summary];
  }
  return [];
}

function buildContextEntries(path: Entry[]): Entry[] {
  let compaction: CompactionEntry | undefined;
  for (const entry of path) if (entry.type === 'compaction') compaction = entry;
  if (!compaction) return path;
  const compactionIdx = path.indexOf(compaction);
  const contextEntries: Entry[] = [compaction];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    const entry = path[i]!;
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept && !(entry.type === 'message' && entry.message.role === 'system'))
      contextEntries.push(entry);
  }
  contextEntries.push(...path.slice(compactionIdx + 1));
  return contextEntries;
}

/** CLI `buildSessionProjection`: compaction-aware, omissions applied. */
export function buildProjection(path: Entry[]): Projection {
  const contextEntries = buildContextEntries(path);
  const omitted = new Set<string>();
  for (const entry of contextEntries)
    if (entry.type === 'context_edit') omitted.add(entry.targetId);
  const entries = contextEntries.map(
    (sourceEntry, index): ProjectedEntry => ({
      sourceEntry,
      messages:
        (sourceEntry.type === 'compaction' && index > 0) || omitted.has(sourceEntry.id)
          ? []
          : entryToContextMessages(sourceEntry),
    }),
  );
  return { entries, messages: entries.flatMap((entry) => entry.messages) };
}

// ---- Token calculation ----

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (
    msg.role === 'assistant' &&
    msg.stopReason !== 'aborted' &&
    msg.stopReason !== 'error' &&
    msg.usage &&
    calculateContextTokens(msg.usage) > 0
  )
    return msg.usage;
  return undefined;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  let index = -1;
  let usage: Usage | undefined;
  for (let i = messages.length - 1; i >= 0 && !usage; i--) {
    usage = getAssistantUsage(messages[i]!);
    index = i;
  }
  if (!usage) {
    let estimated = 0;
    for (const message of messages) estimated += estimateTokens(message);
    return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
  }
  const usageTokens = calculateContextTokens(usage);
  let trailingTokens = 0;
  for (let i = index + 1; i < messages.length; i++) trailingTokens += estimateTokens(messages[i]!);
  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: index,
  };
}

/** Does not trust usage captured before a later omission or compaction. */
export function estimateProjectedContextTokens(
  projection: Projection,
  branchEntries: Entry[],
): ContextUsageEstimate {
  const estimate = estimateContextTokens(projection.messages);
  if (estimate.lastUsageIndex !== null) {
    let projectedMessageIndex = 0;
    let usageEntryId: string | undefined;
    for (const entry of projection.entries) {
      const nextMessageIndex = projectedMessageIndex + entry.messages.length;
      if (estimate.lastUsageIndex < nextMessageIndex) {
        usageEntryId = entry.sourceEntry.id;
        break;
      }
      projectedMessageIndex = nextMessageIndex;
    }
    const usageEntryIndex = usageEntryId
      ? branchEntries.findIndex((entry) => entry.id === usageEntryId)
      : -1;
    let latestInvalidatingEntryIndex = -1;
    for (let i = branchEntries.length - 1; i >= 0; i--) {
      const type = branchEntries[i]!.type;
      if (type === 'context_edit' || type === 'compaction') {
        latestInvalidatingEntryIndex = i;
        break;
      }
    }
    if (usageEntryIndex > latestInvalidatingEntryIndex) return estimate;
  }
  const currentSystem = getCurrentSystemMessage(projection.messages as Message[]);
  let tokens = currentSystem ? estimateTokens(currentSystem) : 0;
  for (const message of projection.messages)
    if (message.role !== 'system') tokens += estimateTokens(message);
  return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}

export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

const ESTIMATED_IMAGE_CHARS = 4800;

function contentChars(content: string | readonly { type: string; text?: string }[]): number {
  if (typeof content === 'string') return content.length;
  let chars = 0;
  for (const block of content) {
    if (block.type === 'text' && block.text) chars += block.text.length;
    else if (block.type === 'image') chars += ESTIMATED_IMAGE_CHARS;
  }
  return chars;
}

/** chars/4 heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case 'system':
      chars = contentChars(message.content);
      for (const section of Object.values(message.sections ?? {}))
        if (section) chars += section.length;
      if (message.toolsAdded) chars += JSON.stringify(message.toolsAdded).length;
      return Math.ceil(chars / 4);
    case 'user':
    case 'toolResult':
      return Math.ceil(contentChars(message.content) / 4);
    case 'assistant':
      for (const block of message.content) {
        if (block.type === 'text') chars += block.text.length;
        else if (block.type === 'thinking') chars += block.thinking.length;
        else if (block.type === 'toolCall')
          chars += block.name.length + JSON.stringify(block.arguments).length;
      }
      return Math.ceil(chars / 4);
    case 'compactionSummary':
      return Math.ceil(message.summary.length / 4);
  }
  return 0;
}

// ---- Cut point detection ----

function isCutPointMessage(message: AgentMessage): boolean {
  return (
    message.role === 'user' || message.role === 'assistant' || message.role === 'compactionSummary'
  );
}

function isTurnStartMessage(message: AgentMessage): boolean {
  return message.role === 'user' || message.role === 'compactionSummary';
}

interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

function isProjectedTurnStart(entry: ProjectedEntry): boolean {
  if (entry.sourceEntry.type === 'compaction') return false;
  return entry.messages.some(isTurnStartMessage);
}

function findProjectedCutPoint(
  entries: ProjectedEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i]!;
    if (entry.sourceEntry.type !== 'compaction' && entry.messages.some(isCutPointMessage))
      cutPoints.push(i);
  }
  if (cutPoints.length === 0)
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };

  let accumulatedTokens = 0;
  let exceededBudget = false;
  let cutIndex = cutPoints[0]!;
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const messageTokens = entries[i]!.messages.reduce(
      (sum, message) => sum + estimateTokens(message),
      0,
    );
    if (messageTokens === 0) continue;
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      exceededBudget = true;
      cutIndex = cutPoints.find((candidate) => candidate >= i) ?? cutPoints[cutPoints.length - 1]!;
      break;
    }
  }

  // A recovery attempt and its omission are context-invisible after the last visible input.
  const suffix = entries.slice(cutIndex + 1, endIndex);
  const isVisible = (entry: ProjectedEntry) =>
    entry.sourceEntry.type !== 'context_edit' &&
    entryToContextMessages(entry.sourceEntry).length > 0;
  const isOmitted = (entry: ProjectedEntry) => isVisible(entry) && entry.messages.length === 0;
  if (
    exceededBudget &&
    suffix.some(
      (entry) =>
        entry.sourceEntry.type === 'message' &&
        entry.sourceEntry.message.role === 'assistant' &&
        isOmitted(entry),
    ) &&
    suffix.every(
      (entry) => entry.sourceEntry.type !== 'compaction' && (!isVisible(entry) || isOmitted(entry)),
    )
  )
    cutIndex++;

  while (cutIndex > startIndex) {
    const previous = entries[cutIndex - 1]!;
    if (previous.sourceEntry.type === 'compaction' || previous.messages.length > 0) break;
    cutIndex--;
  }
  const startsTurn = isProjectedTurnStart(entries[cutIndex]!);
  let turnStartIndex = -1;
  if (!startsTurn)
    for (let i = cutIndex; i >= startIndex; i--)
      if (isProjectedTurnStart(entries[i]!)) {
        turnStartIndex = i;
        break;
      }
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
  };
}

// ---- File operations ----

export interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
  if (message.role !== 'assistant') return;
  for (const block of message.content) {
    if (block.type !== 'toolCall') continue;
    const path = typeof block.arguments?.path === 'string' ? block.arguments.path : undefined;
    if (!path) continue;
    if (block.name === 'read') fileOps.read.add(path);
    else if (block.name === 'write') fileOps.written.add(path);
    else if (block.name === 'edit') fileOps.edited.add(path);
  }
}

function computeFileLists(fileOps: FileOperations): CompactionDetails {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  return {
    readFiles: [...fileOps.read].filter((f) => !modified.has(f)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join('\n')}\n</read-files>`);
  if (modifiedFiles.length > 0)
    sections.push(`<modified-files>\n${modifiedFiles.join('\n')}\n</modified-files>`);
  if (sections.length === 0) return '';
  return `\n\n${sections.join('\n\n')}`;
}

// ---- Preparation ----

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

function compactionMessages(entry: ProjectedEntry): AgentMessage[] {
  if (entry.sourceEntry.type === 'compaction') return [];
  return entry.messages.filter((message) => message.role !== 'system');
}

export function prepareCompaction(
  pathEntries: Entry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined {
  if (pathEntries.at(-1)?.type === 'compaction') return undefined;
  const projection = buildProjection(pathEntries);
  const projected = projection.entries;
  const previousIndex = projected.findIndex(
    (entry) => entry.sourceEntry.type === 'compaction' && entry.messages.length > 0,
  );
  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (previousIndex >= 0) {
    previousSummary = (projected[previousIndex]!.sourceEntry as CompactionEntry).summary;
    boundaryStart = previousIndex + 1;
  }
  const tokensBefore = estimateProjectedContextTokens(projection, pathEntries).tokens;
  const cutPoint = findProjectedCutPoint(
    projected,
    boundaryStart,
    projected.length,
    settings.keepRecentTokens,
  );
  const firstKeptEntry = projected[cutPoint.firstKeptEntryIndex]?.sourceEntry;
  if (!firstKeptEntry?.id) return undefined;
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize = projected
    .slice(boundaryStart, historyEnd)
    .flatMap(compactionMessages);
  const turnPrefixMessages = cutPoint.isSplitTurn
    ? projected
        .slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
        .flatMap(compactionMessages)
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

  const fileOps: FileOperations = { read: new Set(), written: new Set(), edited: new Set() };
  if (previousIndex >= 0) {
    const details = (projected[previousIndex]!.sourceEntry as CompactionEntry).details as
      | Partial<CompactionDetails>
      | undefined;
    if (Array.isArray(details?.readFiles)) for (const f of details.readFiles) fileOps.read.add(f);
    if (Array.isArray(details?.modifiedFiles))
      for (const f of details.modifiedFiles) fileOps.edited.add(f);
  }
  for (const message of messagesToSummarize) extractFileOpsFromMessage(message, fileOps);
  if (cutPoint.isSplitTurn)
    for (const message of turnPrefixMessages) extractFileOpsFromMessage(message, fileOps);

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    ...(previousSummary === undefined ? {} : { previousSummary }),
    fileOps,
    settings,
  };
}

// ---- Summarization ----

const TOOL_RESULT_MAX_CHARS = 2000;

function sliceHead(text: string, maxUnits: number): string {
  const end = Math.max(0, maxUnits);
  const high = text.charCodeAt(end - 1);
  const low = text.charCodeAt(end);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
    ? text.slice(0, end - 1)
    : text.slice(0, end);
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${sliceHead(text, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/** Thinking is omitted; visible text, tool calls and results record what happened. */
export function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = contentText(msg.content, '');
      if (content) parts.push(`[User]: ${content}`);
    } else if (msg.role === 'assistant') {
      const toolCalls: string[] = [];
      for (const block of msg.content) {
        if (block.type !== 'toolCall') continue;
        const args = Object.entries(block.arguments as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        toolCalls.push(`${block.name}(${args})`);
      }
      if (msg.content.some((block) => block.type === 'text'))
        parts.push(`[Assistant]: ${contentText(msg.content)}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`);
    } else if (msg.role === 'toolResult') {
      const content = contentText(msg.content, '');
      if (content)
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
    }
  }
  return parts.join('\n\n');
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `The messages above are earlier context from an ongoing conversation. Later messages are stored separately and do not need to be reconstructed.

Create a concise checkpoint of the user's request and the progress shown above. This checkpoint will be placed before the later messages so the conversation can continue with the necessary context.

## Original Request
[What did the user ask for?]

## Progress So Far
- [Key decisions and work completed in these messages]

## Context Needed to Continue
- [Information from these messages needed to understand the later work]

Only summarize information explicitly present above. Do not infer or recreate later messages.`;

/** Rifty's request seam in place of the CLI's model/apiKey/streamFn arguments. */
export type Complete = (
  context: TranscriptContext,
  options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface SummaryRequest {
  complete: Complete;
  reasoning: boolean;
  thinkingLevel?: string;
  signal?: AbortSignal;
  retry?: RetryPolicy;
  callbacks?: RetryCallbacks;
}

function summarizationFailure(response: AssistantMessage, label: string): string | undefined {
  if (response.stopReason === 'error')
    return `${label} failed: ${response.errorMessage || 'Unknown error'}`;
  if (response.stopReason === 'length')
    return `${label} failed: generation hit the token cap and the summary is incomplete`;
  return undefined;
}

async function summarize(
  promptText: string,
  label: string,
  request: SummaryRequest,
): Promise<{ text: string; usage: Usage }> {
  const options: SimpleStreamOptions = {
    signal: request.signal,
    cacheRetention: 'none',
    sessionId: uuidv7(),
  };
  if (request.reasoning && request.thinkingLevel && request.thinkingLevel !== 'off')
    options.reasoning = request.thinkingLevel as SimpleStreamOptions['reasoning'];
  const context = normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: [{ type: 'text', text: promptText }], timestamp: Date.now() },
    ],
  });
  const response = await retryAssistantCall(
    () => request.complete(context, options),
    request.retry,
    request.signal,
    request.callbacks,
  );
  const failure = summarizationFailure(response, label);
  if (failure) throw new Error(failure);
  if (response.content.some((block) => block.type === 'toolCall'))
    throw new Error(`${label} attempted to call a tool`);
  return { text: contentText(response.content), usage: response.usage };
}

function generateSummary(
  messages: AgentMessage[],
  previousSummary: string | undefined,
  request: SummaryRequest,
) {
  const conversationText = serializeConversation(convertToLlm(messages));
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary)
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  promptText += previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  return summarize(promptText, 'Summarization', request);
}

function combineUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

export interface CompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage: Usage;
  details: CompactionDetails;
}

export async function compact(
  preparation: CompactionPreparation,
  request: SummaryRequest,
): Promise<CompactionResult> {
  const { messagesToSummarize, turnPrefixMessages, isSplitTurn, previousSummary } = preparation;
  let summary: string;
  let usage: Usage;
  if (isSplitTurn && turnPrefixMessages.length > 0) {
    let historyText = previousSummary ?? 'No prior history.';
    let historyUsage: Usage | undefined;
    if (messagesToSummarize.length > 0) {
      const history = await generateSummary(messagesToSummarize, previousSummary, request);
      historyText = history.text;
      historyUsage = history.usage;
    }
    const prefix = await summarize(
      `# Conversation\n${serializeConversation(convertToLlm(turnPrefixMessages))}\n\n# Instructions\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`,
      'Turn prefix summarization',
      request,
    );
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${prefix.text}`;
    usage = historyUsage ? combineUsage(historyUsage, prefix.usage) : prefix.usage;
  } else {
    const result = await generateSummary(messagesToSummarize, previousSummary, request);
    summary = result.text;
    usage = result.usage;
  }
  const details = computeFileLists(preparation.fileOps);
  summary += formatFileOperations(details.readFiles, details.modifiedFiles);
  return {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    usage,
    details,
  };
}
