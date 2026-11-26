// Probe only: pdfjs-dist 6 legacy + its worker as one CommonJS file (the guest has no ES module loader).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
globalThis.pdfjsWorker = worker; // main-thread handler: pdf.js then never import()s the worker file
export const getDocument = pdfjs.getDocument;
