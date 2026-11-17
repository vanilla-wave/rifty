# PDF text fixtures

Inputs for `tests/no-coi/no-coi-pdf-text.spec.ts`; the committed bytes are the authority.

- `invoice.pdf` — 1 page, PDFKit 0.20.2, standard Helvetica (not embedded), FlateDecode.
- `report.pdf` — 2 pages, PDFKit 0.20.2 with an embedded TrueType subset of
  LiberationSans-Regular (from `pdfjs-dist@6.5.438/standard_fonts`; Liberation
  license §1(a) font-embedding exception).
- `pdfjs-text.mjs`, `pdf-parse-text.cjs` — the probes, run unchanged by native Node and by rifty.
