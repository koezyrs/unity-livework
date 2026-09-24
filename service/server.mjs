import http from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BlockList, isIPv4 } from 'node:net';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const signaling = require('./generated/signaling.cjs');
const root = path.dirname(fileURLToPath(import.meta.url));
const commands = new Set(['Play', 'Stop', 'Pause', 'Resume', 'Step', 'SetResolution', 'SetStreamQuality']);
const qualities = new Set(['smooth', 'balanced', 'sharp']);
const levels = new Set(['info', 'warning', 'error']);
const maxLogs = 500, maxScenes = 2000;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const scenePath = value => typeof value === 'string' && value.length <= 512 && /\.unity$/i.test(value);
// Restarting in another scene exits and enters Play Mode, which can reload scripts twice.
const commandTimeout = msg => msg.command === 'Play' && msg.scene !== undefined ? 60000 : 20000;
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
export const tailscale = ['100.64.0.0/10', 'fd7a:115c:a1e0::/48'];
/** Returns a check that accepts loopback and any address inside the given CIDR ranges. */
export function createTrust(cidrs) {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [network, prefix] = cidr.split('/');
    list.addSubnet(network, Number(prefix), isIPv4(network) ? 'ipv4' : 'ipv6');
  }
  return address => {
    if (typeof address !== 'string') return false;
    if (loopback(address)) return true;
    const plain = address.replace(/^::ffff:(?=\d+\.)/, '');
    try { return list.check(plain, isIPv4(plain) ? 'ipv4' : 'ipv6'); } catch { return false; }
  };
}
const equal = (a, b) => {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const send = (ws, msg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const cookie = req => /(?:^|;\s*)livework=([^;]+)/.exec(req.headers.cookie || '')?.[1];

export async function createLiveWork({ port = 8080, host = '127.0.0.1', code = String(randomInt(100000, 1000000)), hostToken = randomBytes(32).toString('hex'), persist = false, stateDirectory = path.join(root, '.local'), mode = 'tailscale', trust = tailscale } = {}) {
  const trustedNetwork = createTrust(trust);
  let editor, controller, signalEditor, signalBrowser, session, sessionExpires = 0, editorLostTimer;
  const editorOffline = 'Unity Editor is not connected. Open Window > LiveWork in Unity and start the server.';
  let state = { v: 1, type: 'state', state: 'offline', message: 'Waiting for Unity Editor…', width: 0, height: 0 };
  const pending = new Map(), attempts = new Map();
  let scenes = { v: 1, type: 'scenes', scenes: [], truncated: false }, scenePaths = new Set(), logs = [], logSeq = 0;
  // Unity logs the signaling URL, which holds the host token; the browser must never see it.
  const logText = (value, max) => text(typeof value === 'string' ? value.replaceAll(hostToken, '[host token]') : '', max);
  let closing;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  signaling.reset('public');
  const authenticated = req => session && Date.now() < sessionExpires && equal(cookie(req), session);
  const sameOrigin = req => !req.headers.origin || req.headers.origin === `http://${req.headers.host}` || req.headers.origin === `https://${req.headers.host}`;
  const result = (ws, id, ok, message) => send(ws, { v: 1, type: 'result', id, ok, message });
  const clearPending = reason => { for (const [id, p] of pending) { clearTimeout(p.timer); result(p.ws, id, false, reason); } pending.clear(); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); };
    if (!trustedNetwork(req.socket.remoteAddress)) return json(403, { error: 'This address is not allowed. Use the network chosen in the Unity LiveWork window.' });
    if (!sameOrigin(req)) return json(403, { error: 'Origin rejected' });
    if (url.pathname === '/api/shutdown') {
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
      if (!loopback(req.socket.remoteAddress) || !equal(req.headers.authorization, `Bearer ${hostToken}`)) return json(403, { error: 'Host authorization required' });
      res.once('finish', () => { close().catch(error => console.error('LiveWork shutdown failed:', error.message)); });
      return json(200, { ok: true });
    }
    if (url.pathname === '/api/health') return json(200, { service: 'Unity LiveWork', version: 1 });
    if (url.pathname === '/api/session' && req.method === 'GET') return json(200, { authenticated: Boolean(authenticated(req)) });
    if (url.pathname === '/api/pair' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      const entry = attempts.get(ip) || { count: 0, until: Date.now() + 60000 };
      if (Date.now() > entry.until) { entry.count = 0; entry.until = Date.now() + 60000; }
      attempts.set(ip, entry);
      if (++entry.count > 10) return json(429, { error: 'Too many attempts; wait one minute' });
      let body = '';
      try { for await (const chunk of req) { body += chunk; if (body.length > 1024) return json(413, { error: 'Request too large' }); } }
      catch { return; }
      let supplied; try { supplied = JSON.parse(body).code; } catch { return json(400, { error: 'Invalid JSON' }); }
      if (!equal(supplied, code)) return json(401, { error: 'Incorrect pairing code' });
      if (controller && !authenticated(req)) return json(409, { error: 'Another browser is controlling Unity' });
      if (!authenticated(req)) session = randomBytes(32).toString('hex');
      sessionExpires = Date.now() + 24 * 60 * 60 * 1000;
      return json(200, { ok: true }, { 'Set-Cookie': `livework=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` });
    }
    if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
    let relative; try { relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); } catch { return json(400, { error: 'Invalid path' }); }
    const filename = path.resolve(root, 'public', '.' + relative);
    if (!filename.startsWith(path.join(root, 'public') + path.sep)) return json(403, { error: 'Invalid path' });
    try {
      const data = await readFile(filename);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'" }); res.end(data);
    } catch { json(404, { error: 'Not found' }); }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const local = ['/editor', '/signal/editor'].includes(url.pathname);
    const deny = () => { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); };
    if (!trustedNetwork(req.socket.remoteAddress)) return deny();
    if (!sameOrigin(req)) return deny();
    if (local ? !loopback(req.socket.remoteAddress) || !equal(url.searchParams.get('token'), hostToken) : !authenticated(req)) return deny();
    if (!['/editor', '/control', '/signal/editor', '/signal/browser'].includes(url.pathname)) return deny();
    if ((url.pathname === '/control' && controller) || (url.pathname === '/editor' && editor) || (url.pathname === '/signal/editor' && signalEditor) || (url.pathname === '/signal/browser' && (!controller || signalBrowser))) return deny();
    wss.handleUpgrade(req, socket, head, ws => {
      ws.alive = true;
      ws.on('pong', () => ws.alive = true);
      ws.on('error', () => {});
      if (url.pathname.startsWith('/signal/')) {
        if (local) signalEditor = ws; else signalBrowser = ws;
        signaling.add(ws);
        ws.on('message', bytes => {
          try {
            const msg = JSON.parse(bytes.toString());
            if (msg.type === 'connect' && typeof msg.connectionId === 'string' && msg.connectionId.length <= 128) signaling.onConnect(ws, msg.connectionId);
            else if (msg.type === 'disconnect' && typeof msg.connectionId === 'string') signaling.onDisconnect(ws, msg.connectionId);
            else if (['offer', 'answer', 'candidate'].includes(msg.type) && typeof msg.data?.connectionId === 'string') {
              if (msg.type === 'offer') signaling.onOffer(ws, msg.data);
              if (msg.type === 'answer') signaling.onAnswer(ws, msg.data);
              if (msg.type === 'candidate') signaling.onCandidate(ws, msg.data);
            }
          } catch { ws.close(1008, 'Invalid signaling message'); }
        });
        ws.on('close', () => { signaling.remove(ws); if (local) signalEditor = undefined; else { signalBrowser = undefined; send(editor, { v: 1, type: 'resetInput' }); } });
        return;
      }
      if (local) { editor = ws; clearTimeout(editorLostTimer); send(ws, { v: 1, type: 'hello' }); }
      else { controller = ws; send(ws, state); send(ws, scenes); send(ws, { v: 1, type: 'logs', entries: logs, replay: true }); }
      ws.on('message', bytes => {
        let msg; try { msg = JSON.parse(bytes.toString()); } catch { return ws.close(1008, 'Invalid JSON'); }
        if (msg.v !== 1) return ws.close(1008, 'Unsupported protocol');
        if (local) {
          if (msg.type === 'state') { state = msg; send(controller, state); }
          if (msg.type === 'result' && pending.has(msg.id)) { const p = pending.get(msg.id); clearTimeout(p.timer); pending.delete(msg.id); send(p.ws, msg); }
          if (msg.type === 'scenes' && Array.isArray(msg.scenes)) {
            const list = msg.scenes.filter(s => scenePath(s?.path)).slice(0, maxScenes).map(s => ({ path: s.path, name: text(s.name, 256) || s.path, inBuild: s.inBuild === true }));
            scenes = { v: 1, type: 'scenes', scenes: list, truncated: msg.truncated === true || list.length < msg.scenes.length };
            scenePaths = new Set(list.map(s => s.path)); send(controller, scenes);
          }
          if (msg.type === 'logs' && Array.isArray(msg.entries)) {
            // The service numbers entries itself, so the order stays valid when Unity restarts.
            const entries = msg.entries.slice(0, 100).filter(e => levels.has(e?.level)).map(e => ({ seq: ++logSeq, level: e.level, message: logText(e.message, 4000), stack: logText(e.stack, 8000), time: Number.isFinite(e.time) ? e.time : Date.now() }));
            logs.push(...entries); if (logs.length > maxLogs) logs.splice(0, logs.length - maxLogs);
            if (entries.length) send(controller, { v: 1, type: 'logs', entries });
          }
          return;
        }
        if (msg.type === 'resetInput') { send(editor, msg); return; }
        if (msg.type !== 'command' || typeof msg.id !== 'string' || msg.id.length > 128 || !commands.has(msg.command)) return result(ws, msg.id, false, 'Invalid command');
        if (pending.has(msg.id)) return result(ws, msg.id, false, 'This command is already running.');
        if (pending.size >= 16) return result(ws, msg.id, false, 'Too many commands are waiting. Try again in a moment.');
        if (msg.command === 'SetResolution' && (!Number.isInteger(msg.width) || !Number.isInteger(msg.height) || msg.width < 240 || msg.height < 240 || msg.width > 1920 || msg.height > 1920 || msg.width % 2 || msg.height % 2 || msg.width * msg.height > 2073600)) return result(ws, msg.id, false, 'Use even dimensions 240–1920, up to 2,073,600 pixels');
        if (msg.command === 'SetStreamQuality' && !qualities.has(msg.quality)) return result(ws, msg.id, false, 'Unknown stream quality');
        if (msg.command === 'Play' && msg.scene !== undefined && (!scenePath(msg.scene) || !scenePaths.has(msg.scene))) return result(ws, msg.id, false, 'This scene is not in the project scene list.');
        if (!editor || editor.readyState !== WebSocket.OPEN) return result(ws, msg.id, false, 'Unity Editor is not connected. The command was not sent.');
        pending.set(msg.id, { ws, timer: setTimeout(() => { pending.delete(msg.id); result(ws, msg.id, false, 'Unity did not confirm the command. Check the Editor before you try again.'); }, commandTimeout(msg)) });
        send(editor, msg);
      });
      ws.on('close', () => {
        if (local) {
          editor = undefined; signalEditor?.close();
          // Unity closes this socket on every script reload (entering Play Mode too); keep its reload message.
          // If Unity does not come back, report it as disconnected.
          const setOffline = () => { state = { ...state, state: 'offline', message: editorOffline }; send(controller, state); };
          if (state.state === 'reloading') { clearTimeout(editorLostTimer); editorLostTimer = setTimeout(() => { if (!editor) setOffline(); }, 60000); }
          else setOffline();
        }
        else { clearPending('Controller disconnected; command was not replayed'); controller = undefined; signalBrowser?.close(); send(editor, { v: 1, type: 'resetInput' }); }
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [ip, attempt] of attempts) if (Date.now() > attempt.until) attempts.delete(ip);
    if (controller && Date.now() > sessionExpires) controller.close(1008, 'Session expired');
  }, 10000);
  heartbeat.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actualPort = server.address().port;
  const config = { port: actualPort, host, code, hostToken, pid: process.pid, mode, trust };
  if (persist) { await mkdir(stateDirectory, { recursive: true }); await writeFile(path.join(stateDirectory, 'host.json'), JSON.stringify(config, null, 2)); }
  function close() {
    if (closing) return closing;
    closing = (async () => {
    clearInterval(heartbeat); clearTimeout(editorLostTimer); clearPending('Service stopped');
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
    wss.close();
    if (persist) await unlink(path.join(stateDirectory, 'host.json')).catch(() => {});
    })();
    return closing;
  }
  return { ...config, server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createLiveWork({ port: Number(process.env.LIVEWORK_PORT || 8080), host: process.env.LIVEWORK_BIND || '0.0.0.0', stateDirectory: process.env.LIVEWORK_STATE_DIRECTORY, persist: true,
    mode: process.env.LIVEWORK_MODE || 'tailscale', trust: process.env.LIVEWORK_TRUST ? process.env.LIVEWORK_TRUST.split(',').map(s => s.trim()).filter(Boolean) : tailscale });
  console.log(`Unity LiveWork: http://${app.host}:${app.port}\nPairing code: ${app.code}\nConnection mode: ${app.mode}. Trusted networks: ${app.trust.join(', ')}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
