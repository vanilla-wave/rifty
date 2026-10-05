const HOST_CONSTRUCTOR = Symbol.for('rifty.io.host-message-channel.v1');
export const HOST_MESSAGE_PORT = Symbol.for('rifty.io.host-message-port.v1');
if (!Reflect.has(globalThis, HOST_CONSTRUCTOR)) {
  Object.defineProperty(globalThis, HOST_CONSTRUCTOR, { value: globalThis.MessageChannel });
}

export function markHostMessagePort(port: MessagePort): void {
  if (!Reflect.has(port, HOST_MESSAGE_PORT))
    Object.defineProperty(port, HOST_MESSAGE_PORT, { value: true });
}

/** Kernel/control channels never acquire a guest Node event-loop reference. */
export function createHostMessageChannel(): MessageChannel {
  const Native = Reflect.get(globalThis, HOST_CONSTRUCTOR) as typeof MessageChannel;
  const channel = new Native();
  markHostMessagePort(channel.port1);
  markHostMessagePort(channel.port2);
  return channel;
}
