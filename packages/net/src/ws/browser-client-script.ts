export interface WebSocketBridgeInstrumentation {
  readonly eventPrefix?: string;
  readonly openFlag?: string;
  readonly lastMessageFlag?: string;
}

export interface WebSocketBridgeClientScriptOptions {
  readonly bridgeHosts?: readonly string[];
  readonly instrumentation?: WebSocketBridgeInstrumentation;
}

/**
 * Browser-realm WebSocket constructor shim backed by the rifty WS bridge.
 *
 * The script is self-contained so hosts can inject it before framework dev
 * clients run. It preserves native WebSocket for URLs outside the configured
 * preview hosts.
 */
export function webSocketBridgeClientScript(opts: WebSocketBridgeClientScriptOptions = {}): string {
  const bridgeHosts = [...new Set(opts.bridgeHosts ?? [])];
  const eventPrefix = opts.instrumentation?.eventPrefix ?? '';
  const openFlag = opts.instrumentation?.openFlag ?? '';
  const lastMessageFlag = opts.instrumentation?.lastMessageFlag ?? '';
  return `(function () {
  if (typeof window === 'undefined') return;
  if (typeof BroadcastChannel === 'undefined') return;
  if (window.__riftyWebSocketBridgeInstalled) return;
  window.__riftyWebSocketBridgeInstalled = true;
  var NativeWebSocket = window.WebSocket;
  var CHANNEL_PREFIX = 'rifty:ws:';
  var bridgeHosts = ${JSON.stringify(bridgeHosts)};
  var eventPrefix = ${JSON.stringify(eventPrefix)};
  var openFlag = ${JSON.stringify(openFlag)};
  var lastMessageFlag = ${JSON.stringify(lastMessageFlag)};
  function toWsUrl(raw) {
    var base = window.location && window.location.href ? window.location.href : 'http://localhost/';
    var url = new URL(String(raw), base);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url;
  }
  function channelNameFor(url) {
    return CHANNEL_PREFIX + url.host + url.pathname;
  }
  function portChannelNameFor(url) {
    var port = url.port || (url.protocol === 'wss:' ? '443' : '80');
    return channelNameFor(new URL('ws://websocket-port.local:' + port + '/__rifty_ws'));
  }
  function shouldBridge(url) {
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return false;
    return bridgeHosts.indexOf(url.hostname) !== -1;
  }
  function makeCloseEvent(code, reason, wasClean) {
    try {
      return new CloseEvent('close', { code: code, reason: reason, wasClean: wasClean });
    } catch (_) {
      var ev = new Event('close');
      ev.code = code;
      ev.reason = reason;
      ev.wasClean = wasClean;
      return ev;
    }
  }
  function makeDomException(message, name) {
    try {
      return new DOMException(message, name);
    } catch (_) {
      var err = new Error(message);
      err.name = name;
      return err;
    }
  }
  function makeInvalidStateError(message) {
    return makeDomException(message, 'InvalidStateError');
  }
  function isValidProtocolToken(protocol) {
    return /^[!#$%&'*+\\-.^_\`|~0-9A-Za-z]+$/.test(protocol);
  }
  function normalizeProtocols(protocols) {
    var seen = Object.create(null);
    function add(protocol) {
      if (typeof protocol !== 'string' || !isValidProtocolToken(protocol)) {
        throw makeDomException("Failed to construct 'WebSocket': The subprotocol '" + String(protocol) + "' is invalid.", 'SyntaxError');
      }
      if (seen[protocol]) {
        throw makeDomException("Failed to construct 'WebSocket': The subprotocol '" + protocol + "' is duplicated.", 'SyntaxError');
      }
      seen[protocol] = true;
      return protocol;
    }
    if (Array.isArray(protocols)) {
      var out = [];
      for (var i = 0; i < protocols.length; i++) {
        out.push(add(protocols[i]));
      }
      return out;
    }
    if (typeof protocols === 'string') return [add(protocols)];
    return [];
  }
  function validateCloseParams(code, reason) {
    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw makeDomException("Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999.", 'InvalidAccessError');
    }
    if (new TextEncoder().encode(reason).byteLength > 123) {
      throw makeDomException("Failed to execute 'close' on 'WebSocket': The message must not be greater than 123 bytes.", 'SyntaxError');
    }
  }
  function arrayBufferFromBinary(data) {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return null;
  }
  function messageDataForBinaryType(data, binaryType) {
    var ab = arrayBufferFromBinary(data);
    if (!ab) return data;
    if (binaryType === 'arraybuffer') return ab;
    if (typeof Blob !== 'undefined') return new Blob([ab]);
    return ab;
  }
  function postOutgoingData(socket, data) {
    if (!socket.__activeChannel) return;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data.arrayBuffer().then(function (buffer) {
        if (socket.readyState !== RiftyBridgeWebSocket.OPEN || !socket.__activeChannel) return;
        socket.__activeChannel.postMessage({ type: 'msg', cid: socket.__cid, data: buffer });
      }, function () {
        if (socket.readyState !== RiftyBridgeWebSocket.OPEN) return;
        emit(socket, new Event('error'));
        socket.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(socket, makeCloseEvent(1006, 'failed to read Blob websocket payload', false));
        socket.__cleanup();
      });
      return;
    }
    socket.__activeChannel.postMessage({ type: 'msg', cid: socket.__cid, data: data });
  }
  function emit(socket, event) {
    var handler = socket['on' + event.type];
    if (typeof handler === 'function') {
      try { handler.call(socket, event); } catch (err) { setTimeout(function () { throw err; }, 0); }
    }
    socket.dispatchEvent(event);
  }
  function publish(kind, payload) {
    if (kind === 'open' && openFlag) {
      try { window[openFlag] = true; } catch (_) {}
    }
    if (kind === 'message' && lastMessageFlag) {
      try {
        window[lastMessageFlag] = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (_) {
        try { window[lastMessageFlag] = payload; } catch (_) {}
      }
    }
    if (!eventPrefix) return;
    try {
      var eventName = eventPrefix + ':' + kind;
      var detail = payload;
      if (kind === 'message' && typeof payload === 'string') {
        try { detail = JSON.parse(payload); } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    } catch (_) {}
  }
  class RiftyBridgeWebSocket extends EventTarget {
    constructor(rawUrl, protocols) {
      super();
      var target = toWsUrl(rawUrl);
      if (!shouldBridge(target)) {
        if (!NativeWebSocket) throw new Error('Native WebSocket is not available');
        return new NativeWebSocket(rawUrl, protocols);
      }
      this.url = target.href;
      this.protocol = '';
      this.extensions = '';
      this.binaryType = 'blob';
      this.bufferedAmount = 0;
      this.CONNECTING = RiftyBridgeWebSocket.CONNECTING;
      this.OPEN = RiftyBridgeWebSocket.OPEN;
      this.CLOSING = RiftyBridgeWebSocket.CLOSING;
      this.CLOSED = RiftyBridgeWebSocket.CLOSED;
      this.readyState = RiftyBridgeWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.__cid = 'ws-' + Math.random().toString(36).slice(2, 10);
      this.__protocols = normalizeProtocols(protocols);
      this.__channels = [];
      this.__activeChannel = null;
      this.__closeTimer = null;
      this.__onMessage = (e) => this.__handleMessage(e);
      var names = [channelNameFor(target), portChannelNameFor(target)];
      for (var i = 0; i < names.length; i++) {
        if (names.indexOf(names[i]) !== i) continue;
        var channel = new BroadcastChannel(names[i]);
        channel.addEventListener('message', this.__onMessage);
        this.__channels.push(channel);
      }
      for (var j = 0; j < this.__channels.length; j++) {
        this.__channels[j].postMessage({
          type: 'open',
          cid: this.__cid,
          url: this.url,
          protocols: this.__protocols
        });
      }
      this.__connectTimer = setTimeout(() => {
        if (this.readyState !== RiftyBridgeWebSocket.CONNECTING) return;
        this.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(this, new Event('error'));
        emit(this, makeCloseEvent(1006, 'connection refused', false));
        this.__cleanup();
      }, 1000);
    }
    __channelFromEvent(e) {
      for (var i = 0; i < this.__channels.length; i++) {
        if (this.__channels[i] === e.currentTarget) return this.__channels[i];
      }
      return this.__activeChannel || this.__channels[0] || null;
    }
    __closeInactiveChannels() {
      for (var i = this.__channels.length - 1; i >= 0; i--) {
        var channel = this.__channels[i];
        if (channel === this.__activeChannel) continue;
        channel.removeEventListener('message', this.__onMessage);
        channel.close();
        this.__channels.splice(i, 1);
      }
    }
    __handleMessage(e) {
      var f = e.data;
      if (!f || f.cid !== this.__cid) return;
      if (f.type === 'open-ack' && this.readyState === RiftyBridgeWebSocket.CONNECTING) {
        clearTimeout(this.__connectTimer);
        this.__activeChannel = this.__channelFromEvent(e);
        this.__closeInactiveChannels();
        this.protocol = f.protocol || '';
        this.readyState = RiftyBridgeWebSocket.OPEN;
        publish('open');
        emit(this, new Event('open'));
        return;
      }
      if (f.type === 'msg' && this.readyState === RiftyBridgeWebSocket.OPEN) {
        publish('message', f.data);
        emit(this, new MessageEvent('message', { data: messageDataForBinaryType(f.data, this.binaryType) }));
        return;
      }
      if (f.type === 'close' && f.from === 'server') {
        if (this.readyState === RiftyBridgeWebSocket.CLOSED) return;
        if (this.readyState === RiftyBridgeWebSocket.CONNECTING) emit(this, new Event('error'));
        var closeCode = f.code === undefined ? 1000 : f.code;
        var wasClean = closeCode !== 1006 && this.readyState !== RiftyBridgeWebSocket.CONNECTING;
        this.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(this, makeCloseEvent(closeCode, f.reason || '', wasClean));
        this.__cleanup();
      }
    }
    send(data) {
      if (this.readyState === RiftyBridgeWebSocket.CONNECTING) {
        throw makeInvalidStateError("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.");
      }
      if (this.readyState !== RiftyBridgeWebSocket.OPEN) return;
      postOutgoingData(this, data);
    }
    close(code, reason) {
      if (
        this.readyState === RiftyBridgeWebSocket.CLOSED ||
        this.readyState === RiftyBridgeWebSocket.CLOSING
      ) return;
      code = code === undefined ? 1000 : code;
      reason = reason === undefined ? '' : String(reason);
      validateCloseParams(code, reason);
      var wasConnecting = this.readyState === RiftyBridgeWebSocket.CONNECTING;
      this.readyState = RiftyBridgeWebSocket.CLOSING;
      var targets = this.__activeChannel ? [this.__activeChannel] : this.__channels;
      for (var i = 0; i < targets.length; i++) {
        targets[i].postMessage({
          type: 'close',
          cid: this.__cid,
          code: code,
          reason: reason,
          from: 'client'
        });
      }
      if (wasConnecting) {
        this.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(this, makeCloseEvent(code, reason, true));
        this.__cleanup();
        return;
      }
      // OPEN → CLOSING: a real WebSocket always finishes the closing handshake —
      // the server echoes the close, or the UA gives up and fires 1006. Mirror
      // the connect timeout so a vanished peer realm can't strand us in CLOSING
      // forever (which would never fire 'close' and leak the BroadcastChannels).
      this.__closeTimer = setTimeout(() => {
        if (this.readyState !== RiftyBridgeWebSocket.CLOSING) return;
        this.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(this, makeCloseEvent(1006, 'close handshake timeout', false));
        this.__cleanup();
      }, 1000);
    }
    __cleanup() {
      clearTimeout(this.__connectTimer);
      clearTimeout(this.__closeTimer);
      for (var i = 0; i < this.__channels.length; i++) {
        this.__channels[i].removeEventListener('message', this.__onMessage);
        this.__channels[i].close();
      }
      this.__channels = [];
      this.__activeChannel = null;
    }
  }
  RiftyBridgeWebSocket.CONNECTING = NativeWebSocket ? NativeWebSocket.CONNECTING : 0;
  RiftyBridgeWebSocket.OPEN = NativeWebSocket ? NativeWebSocket.OPEN : 1;
  RiftyBridgeWebSocket.CLOSING = NativeWebSocket ? NativeWebSocket.CLOSING : 2;
  RiftyBridgeWebSocket.CLOSED = NativeWebSocket ? NativeWebSocket.CLOSED : 3;
  window.WebSocket = RiftyBridgeWebSocket;
})();`;
}
