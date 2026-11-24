// npm candidates as the guest would install them: ponyfills, no global patching.
const wsp = require('web-streams-polyfill');
const ets = require('event-target-shim');
const acp = require('abortcontroller-polyfill/dist/cjs-ponyfill');
globalThis.__npm = {
  EventTarget: ets.EventTarget,
  Event: ets.Event,
  CustomEvent: undefined,
  AbortController: acp.AbortController,
  AbortSignal: acp.AbortSignal,
  ReadableStream: wsp.ReadableStream,
  ReadableStreamDefaultReader: wsp.ReadableStreamDefaultReader,
  ReadableStreamBYOBReader: wsp.ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest: wsp.ReadableStreamBYOBRequest,
  ReadableByteStreamController: wsp.ReadableByteStreamController,
  ReadableStreamDefaultController: wsp.ReadableStreamDefaultController,
  WritableStream: wsp.WritableStream,
  WritableStreamDefaultWriter: wsp.WritableStreamDefaultWriter,
  WritableStreamDefaultController: wsp.WritableStreamDefaultController,
  TransformStream: wsp.TransformStream,
  TransformStreamDefaultController: wsp.TransformStreamDefaultController,
  ByteLengthQueuingStrategy: wsp.ByteLengthQueuingStrategy,
  CountQueuingStrategy: wsp.CountQueuingStrategy,
  TextEncoderStream: undefined,
  TextDecoderStream: undefined,
  DOMException: globalThis.DOMException, // the guest's (web-shim)
};
