export interface TerminalQuickFix {
  readonly label: string;
  readonly command: string;
  readonly interruptBeforeRun?: boolean;
}

export interface TerminalQuickFixContext {
  readonly stderr: string;
  readonly lastCommand?: string;
}

const DID_YOU_MEAN_RE = /Did you mean '([^'\n]+)'\?/g;
const EADDRINUSE_RE = /\bEADDRINUSE\b|address already in use/i;

export type TerminalQuickFixProvider = (
  context: TerminalQuickFixContext,
) => TerminalQuickFix | null;

export const commandSuggestionQuickFix: TerminalQuickFixProvider = ({ stderr }) => {
  let command: string | undefined;
  for (const match of stderr.matchAll(DID_YOU_MEAN_RE)) command = match[1];
  if (!command) return null;
  return {
    label: `Run ${command}`,
    command,
  };
};

export const addressInUseQuickFix: TerminalQuickFixProvider = ({ stderr, lastCommand }) => {
  const command = lastCommand?.trim();
  if (!command || !EADDRINUSE_RE.test(stderr)) return null;
  return {
    label: `Stop and rerun ${command}`,
    command,
    interruptBeforeRun: true,
  };
};

const DEFAULT_PROVIDERS: readonly TerminalQuickFixProvider[] = [
  commandSuggestionQuickFix,
  addressInUseQuickFix,
];

export function detectTerminalQuickFix(
  context: string | TerminalQuickFixContext,
  providers: readonly TerminalQuickFixProvider[] = DEFAULT_PROVIDERS,
): TerminalQuickFix | null {
  const normalized = typeof context === 'string' ? { stderr: context } : context;
  for (const provider of providers) {
    const fix = provider(normalized);
    if (fix) return fix;
  }
  return null;
}
