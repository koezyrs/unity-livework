// Authenticated transport implementing the upstream RenderStreaming signaling interface.
export class LiveWorkSignaling extends EventTarget {
  constructor() {
    super();
    this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal/browser`);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.ws.close(); reject(new Error('Signaling timed out')); }, 8000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Signaling unavailable')); }, { once: true });
      this.ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Signaling closed')); this.dispatchEvent(new CustomEvent('disconnect', { detail: { connectionId: this.connectionId } })); });
    });
    this.ws.addEventListener('message', e => {
      const msg = JSON.parse(e.data);
      const detail = ['connect', 'disconnect'].includes(msg.type) ? msg : { connectionId: msg.from, ...msg.data };
      this.dispatchEvent(new CustomEvent(msg.type, { detail }));
    });
  }
  start() { return this.ready; }
  async stop() { this.ws.close(); }
  send(type, data) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data, connectionId: data.connectionId })); }
  createConnection(connectionId) { this.connectionId = connectionId; this.send('connect', { connectionId }); }
  deleteConnection(connectionId) { this.send('disconnect', { connectionId }); }
  sendOffer(connectionId, sdp) { this.send('offer', { connectionId, sdp }); }
  sendAnswer(connectionId, sdp) { this.send('answer', { connectionId, sdp }); }
  sendCandidate(connectionId, candidate, sdpMid, sdpMLineIndex) { this.send('candidate', { connectionId, candidate, sdpMid, sdpMLineIndex }); }
}
