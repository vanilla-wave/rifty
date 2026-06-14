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
    var pageHost = window.location && window.location.hostname ? window.location.hostname : '';
    if (url.hostname === pageHost) return true;
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
      this.protocol = Array.isArray(protocols) ? (protocols[0] || '') : (protocols || '');
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
      this.__channels = [];
      this.__activeChannel = null;
      this.__onMessage = (e) => this.__handleMessage(e);
      var names = [channelNameFor(target), portChannelNameFor(target)];
      for (var i = 0; i < names.length; i++) {
        if (names.indexOf(names[i]) !== i) continue;
        var channel = new BroadcastChannel(names[i]);
        channel.addEventListener('message', this.__onMessage);
        this.__channels.push(channel);
      }
      for (var j = 0; j < this.__channels.length; j++) {
        this.__channels[j].postMessage({ type: 'open', cid: this.__cid, url: this.url });
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
        this.readyState = RiftyBridgeWebSocket.OPEN;
        publish('open');
        emit(this, new Event('open'));
        return;
      }
      if (f.type === 'msg' && this.readyState === RiftyBridgeWebSocket.OPEN) {
        publish('message', f.data);
        emit(this, new MessageEvent('message', { data: f.data }));
        return;
      }
      if (f.type === 'close' && f.from === 'server') {
        if (this.readyState === RiftyBridgeWebSocket.CLOSED) return;
        this.readyState = RiftyBridgeWebSocket.CLOSED;
        emit(this, makeCloseEvent(f.code || 1000, f.reason || '', true));
        this.__cleanup();
      }
    }
    send(data) {
      if (this.readyState !== RiftyBridgeWebSocket.OPEN) return;
      if (this.__activeChannel) this.__activeChannel.postMessage({ type: 'msg', cid: this.__cid, data: data });
    }
    close(code, reason) {
      if (
        this.readyState === RiftyBridgeWebSocket.CLOSED ||
        this.readyState === RiftyBridgeWebSocket.CLOSING
      ) return;
      this.readyState = RiftyBridgeWebSocket.CLOSING;
      var targets = this.__activeChannel ? [this.__activeChannel] : this.__channels;
      for (var i = 0; i < targets.length; i++) {
        targets[i].postMessage({
          type: 'close',
          cid: this.__cid,
          code: code || 1000,
          reason: reason || '',
          from: 'client'
        });
      }
      this.readyState = RiftyBridgeWebSocket.CLOSED;
      emit(this, makeCloseEvent(code || 1000, reason || '', true));
      this.__cleanup();
    }
    __cleanup() {
      clearTimeout(this.__connectTimer);
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
