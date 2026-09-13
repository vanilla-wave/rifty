# Agent benchmark evidence

Run directories contain raw transcripts, terminal output, model/config/profile
facts, real browser traces, final file differences and common judge evidence.
Edit failureClass/note after inspecting a failed run, then regenerate the
summary with `pnpm agent-bench report <directory>`. Six accepted classes:
agent, rifty-runtime, rifty-tooling, ai-mode-ux, provider, task-bad.
Committed summaries retain the measured matrix; raw run directories are local.
