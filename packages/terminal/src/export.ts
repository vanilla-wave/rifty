export interface TerminalExportArtifact {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function makeTerminalHtmlExport(
  serializedHtml: string,
  createdAt = new Date(),
): TerminalExportArtifact {
  return {
    filename: `rifty-terminal-${stamp(createdAt)}.html`,
    mimeType: 'text/html;charset=utf-8',
    content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rifty terminal output</title>
<meta name="generator" content="rifty">
</head>
<body>
${serializedHtml}
</body>
</html>
`,
  };
}
