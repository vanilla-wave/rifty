// MessageChannel is C++ (node_messaging); streams use it only to transfer a stream (postMessage).
class MessageChannel {
  constructor() {
    throw new Error('probe: MessageChannel not in this port');
  }
}
module.exports = { MessageChannel };
