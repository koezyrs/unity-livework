import { RenderStreaming } from './upstream/renderstreaming.js';
import { LiveWorkSignaling } from './signaling.js';
import { bindInput } from './input.js';
const $ = id => document.getElementById(id);
const video = $('video'), stage = $('stage'), canvas = $('lastFrame');
let control, stream, channel, streamRevision = -1, state = {}, reconnectTimer, mediaTimer, lastStats, generation = 0, requestId = 0;
let connectedOnce = false, mediaReady = false, mediaStarting = false;
let resolutionEdited = false;
const pending = new Map();
const showMessage = text => $('message').textContent = text;
const sendInput = data => { if (channel?.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify({ v: 1, revision: state.revision, ...data })); };
const resetInput = bindInput(stage, video, sendInput, () => mediaReady && state.state === 'playing');

$('pairing').addEventListener('submit', async e => {
  e.preventDefault(); $('pairError').textContent = '';
  try {
    const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) });
    const body = await res.json(); if (!res.ok) throw new Error(body.error);
    $('code').value = ''; connectControl();
  } catch (err) { $('pairError').textContent = err.message; }
});

async function connectControl() {
  clearTimeout(reconnectTimer);
  if (control && control.readyState < 2) return;
  try {
    const session = await (await fetch('/api/session')).json();
    if (!session.authenticated) { connectedOnce = false; $('pairing').hidden = false; $('status').textContent = 'Not paired'; return; }
  } catch { reconnectTimer = setTimeout(connectControl, 2000); return; }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/control`); control = ws;
  $('status').textContent = 'Connecting';
  ws.onopen = () => { connectedOnce = true; $('pairing').hidden = true; showMessage('Connected to LiveWork.'); };
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') updateState(msg);
    else if (msg.type === 'result') { pending.delete(msg.id); if (!msg.ok) showMessage(msg.message); }
  };
  ws.onclose = () => {
    if (control !== ws) return;
    stopMedia(); pending.clear(); updateState({ state: 'offline', message: 'Connection lost. Reconnecting…' });
    $('pairing').hidden = connectedOnce;
    if (!connectedOnce) $('pairError').textContent = 'Enter the pairing code. Only one browser tab can control Unity.';
    else reconnectTimer = setTimeout(connectControl, 2000);
  };
  ws.onerror = () => {};
}

function command(name, args = {}) {
  if (control?.readyState !== WebSocket.OPEN) return;
  resetInput();
  const id = `${Date.now()}-${++requestId}`;
  pending.set(id, Date.now());
  control.send(JSON.stringify({ v: 1, type: 'command', id, command: name, ...args }));
  showMessage(`${name} requested…`);
}
$('play').onclick = () => command('Play'); $('stop').onclick = () => command('Stop');
$('pause').onclick = () => command(state.state === 'paused' ? 'Resume' : 'Pause');
$('step').onclick = () => command('Step');
$('resize').onclick = () => command('SetResolution', { width: Number($('width').value), height: Number($('height').value) });
$('preset').onchange = e => {
  resolutionEdited = Boolean(e.target.value);
  const [w, h] = e.target.value ? e.target.value.split('x') : [state.width, state.height];
  if (w && h) { $('width').value = w; $('height').value = h; }
};
for (const id of ['width', 'height']) $(id).oninput = () => { resolutionEdited = true; $('preset').value = ''; };
$('mute').onclick = async () => { video.muted = !video.muted; $('mute').textContent = video.muted ? '♪ Sound off' : '♪ Sound on'; $('mute').setAttribute('aria-pressed', String(video.muted)); await video.play().catch(() => showMessage('Tap Sound again to allow audio playback.')); };
$('fullscreen').onclick = () => { const action = document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen(); action?.catch(() => showMessage('Fullscreen is unavailable in this browser.')); };
$('lock').onclick = async () => { try { stage.focus(); if (!stage.requestPointerLock) throw new Error(); await stage.requestPointerLock(); } catch { showMessage('Pointer lock requires a supported desktop browser and may require HTTPS.'); } };
$('hidebar').onclick = () => { document.body.classList.add('compact'); $('showbar').hidden = false; };
$('showbar').onclick = () => { document.body.classList.remove('compact'); $('showbar').hidden = true; if (document.fullscreenElement) document.exitFullscreen(); };

function updateState(next) {
  if (next.revision !== state.revision || next.state !== 'playing') resetInput();
  state = next;
  if (state.width && state.height && !resolutionEdited) { $('width').value = state.width; $('height').value = state.height; }
  const running = state.isPlaying || ['playing', 'paused'].includes(state.state), ready = control?.readyState === WebSocket.OPEN && !['offline', 'reloading'].includes(state.state);
  $('status').textContent = state.state || 'Connecting'; $('status').dataset.state = state.state;
  $('play').disabled = !ready || running; $('stop').disabled = !ready || !running;
  $('pause').disabled = !ready || !running; $('pause').textContent = state.state === 'paused' ? '▶ Resume' : 'Ⅱ Pause';
  $('step').disabled = !ready || state.state !== 'paused'; $('resize').disabled = !ready;
  $('inputMode').textContent = state.inputMode === 'legacy-touch' ? 'Legacy Input: touch only · mouse/keyboard unsupported' : state.inputMode === 'both' ? 'Input System + Legacy touch · no Legacy mouse/keyboard' : 'Input System · touch, mouse, keyboard';
  if (state.message) showMessage(state.message);
  else if (state.width) showMessage(`Game View ${state.width} × ${state.height} · frame ${state.frame} · ${state.unity}`);
  $('overlay').hidden = state.state === 'playing' && mediaReady;
  $('overlay').textContent = state.state === 'playing' ? 'Connecting video…' : state.state === 'paused' ? 'Paused · use Next frame to advance' : state.state === 'stopped' ? 'Stopped · press Play when ready' : state.state === 'reloading' ? 'Unity is reloading…' : 'Waiting for Unity…';
  if (!running || !state.streaming) { stopMedia(); return; }
  if (stream && streamRevision !== state.revision) stopMedia();
  if (!stream && !mediaStarting && !mediaTimer) startMedia();
}

async function startMedia() {
  if (!state.streaming || !['playing', 'paused'].includes(state.state)) return;
  const ticket = ++generation; mediaStarting = true; streamRevision = state.revision;
  const rs = new RenderStreaming(new LiveWorkSignaling(), { iceServers: [] }); stream = rs;
  const media = new MediaStream(); video.srcObject = media;
  rs.onConnect = () => {
    if (ticket !== generation) return;
    channel = rs.createDataChannel('livework-input');
    channel.onopen = () => sendInput({ type: 'reset' });
    channel.onclose = () => { if (ticket === generation) retryMedia(); };
    rs.addTransceiver('video', { direction: 'recvonly' }); rs.addTransceiver('audio', { direction: 'recvonly' });
  };
  rs.onTrackEvent = e => {
    if (ticket !== generation) return; media.addTrack(e.track);
    video.play().catch(() => showMessage('Tap Sound or Play to allow video playback.'));
  };
  rs.onDisconnect = () => { if (ticket === generation) retryMedia(); };
  try {
    await rs.start(); if (ticket !== generation) return;
    await rs.createConnection();
    setTimeout(() => { if (ticket === generation && !mediaReady) retryMedia(); }, 12000);
  } catch (err) { if (ticket === generation) { showMessage(err.message); retryMedia(); } }
  finally { if (ticket === generation) mediaStarting = false; }
}
function snapshot() {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
  }
}
function stopMedia() {
  if (!stream && !mediaStarting && !mediaTimer) return;
  snapshot(); resetInput(); generation++; mediaStarting = false; mediaReady = false;
  clearTimeout(mediaTimer); mediaTimer = undefined;
  const previous = stream; stream = undefined; channel = undefined;
  previous?.stop().catch(() => {}); canvas.hidden = !canvas.width || !video.videoWidth;
  video.srcObject = null; lastStats = undefined;
}
function retryMedia() {
  stopMedia(); mediaTimer = setTimeout(() => { mediaTimer = undefined; startMedia(); }, 2000);
}
video.addEventListener('playing', () => { mediaReady = true; canvas.hidden = true; $('placeholder').hidden = true; updateState(state); });
setInterval(async () => {
  sendInput({ type: 'heartbeat' });
  if (stream && mediaReady) {
    try {
      const stats = await stream.getStats(); let videoStat, rtt;
      stats.forEach(s => { if (s.type === 'inbound-rtp' && s.kind === 'video') videoStat = s; if (s.type === 'candidate-pair' && s.nominated) rtt = s.currentRoundTripTime; });
      if (videoStat) {
        const rate = lastStats ? (videoStat.bytesReceived - lastStats.bytesReceived) * 8 / (videoStat.timestamp - lastStats.timestamp) / 1000 : 0;
        $('stats').textContent = `${Math.round(videoStat.framesPerSecond || 0)} FPS · ${rate.toFixed(1)} Mbps · ${rtt == null ? '—' : Math.round(rtt * 1000)} ms RTT`;
        lastStats = videoStat;
      }
    } catch { /* Connection can close between sampling and reading. */ }
  }
  for (const [id, time] of pending) if (Date.now() - time > 22000) { pending.delete(id); showMessage('No command confirmation received. Check the current Editor state before retrying.'); }
}, 500);
window.addEventListener('pagehide', () => { resetInput(); control?.close(); stopMedia(); });
connectControl();
