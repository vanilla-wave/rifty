export type SnippetToken = readonly [text: string, className: string];
export type SnippetLine = readonly SnippetToken[];

export const QUICKSTART_SNIPPET: readonly SnippetLine[] = [
  [
    ['import', 'syn-kw'],
    [' runtimeWorkerUrl ', ''],
    ['from', 'syn-kw'],
    [' ', ''],
    ["'@riftydev/runtime-js/worker?worker&url'", 'syn-str'],
  ],
  [
    ['import', 'syn-kw'],
    [' { ', 'syn-punc'],
    ['checkCapabilities', ''],
    [', ', 'syn-punc'],
    ['createSandbox', ''],
    [' } ', 'syn-punc'],
    ['from', 'syn-kw'],
    [' ', ''],
    ["'@riftydev/sdk'", 'syn-str'],
  ],
  [],
  [
    ['async', 'syn-kw'],
    [' ', ''],
    ['function', 'syn-kw'],
    [' ', ''],
    ['main', 'syn-fn'],
    ['() {', 'syn-punc'],
  ],
  [
    ['  const', 'syn-kw'],
    [' caps ', ''],
    ['= ', 'syn-punc'],
    ['checkCapabilities', 'syn-fn'],
    ['()', 'syn-punc'],
  ],
  [
    ['  if', 'syn-kw'],
    [' (!caps.capabilities.worker ||', 'syn-punc'],
  ],
  [['      !caps.capabilities.crossOriginIsolated) {', 'syn-punc']],
  [
    ['    throw', 'syn-kw'],
    [' new ', 'syn-punc'],
    ['Error', 'syn-fn'],
    ['(caps.summary)', 'syn-punc'],
  ],
  [['  }', 'syn-punc']],
  [],
  [
    ['  const', 'syn-kw'],
    [' sandbox ', ''],
    ['=', 'syn-punc'],
    [' ', ''],
    ['await', 'syn-kw'],
    [' ', ''],
    ['createSandbox', 'syn-fn'],
    ['({', 'syn-punc'],
  ],
  [
    ['    workerUrl', ''],
    [': ', 'syn-punc'],
    ['runtimeWorkerUrl', ''],
    [',', 'syn-punc'],
  ],
  [
    ['    skipServiceWorker: ', ''],
    ['true', 'syn-kw'],
    [',', 'syn-punc'],
  ],
  [['  })', 'syn-punc']],
  [
    ['  sandbox', ''],
    ['.', 'syn-punc'],
    ['runtime', ''],
    ['.', 'syn-punc'],
    ['on', 'syn-fn'],
    ['((event) => {', 'syn-punc'],
  ],
  [
    ['    if', 'syn-kw'],
    [' (event.type === ', 'syn-punc'],
    ["'stdout'", 'syn-str'],
    [') console.log(event.chunk)', 'syn-punc'],
  ],
  [['  })', 'syn-punc']],
  [
    ['  await', 'syn-kw'],
    [' sandbox.runtime.', 'syn-punc'],
    ['eval', 'syn-fn'],
    ['(', 'syn-punc'],
    ['\'console.log("hello from a Worker")\'', 'syn-str'],
    [')', 'syn-punc'],
  ],
  [['}', 'syn-punc']],
  [
    ['void', 'syn-kw'],
    [' ', ''],
    ['main', 'syn-fn'],
    ['()', 'syn-punc'],
  ],
];

export function snippetText(lines: readonly SnippetLine[]): string {
  return lines.map((line) => line.map(([text]) => text).join('')).join('\n');
}
