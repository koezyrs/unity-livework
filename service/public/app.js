import { RenderStreaming } from './upstream/renderstreaming.js';
import { LiveWorkSignaling } from './signaling.js';
import { bindInput } from './input.js';
const $ = id => document.getElementById(id);
const video = $('video'), stage = $('stage'), canvas = $('lastFrame');
let control, stream, channel, streamRevision = -1, state = {}, reconnectTimer, mediaTimer, generation = 0, requestId = 0;
let connectedOnce = false, mediaReady = false, mediaStarting = false, pairing = false, messageTimer, controlGeneration = 0;
let resolutionEdited = false;
const pending = new Map();
const icons = {
  play: '<path fill="currentColor" stroke="none" d="M7 4l13 8-13 8z"/>',
  stop: '<path fill="currentColor" stroke="none" d="M5 5h14v14H5z"/>',
  pause: '<path fill="currentColor" stroke="none" d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  step: '<path fill="currentColor" stroke="none" d="M5 5l11 7L5 19zM17 5h3v14h-3z"/>',
  sound: '<path d="M11 5L6 9H3v6l5 4zM15 8a6 6 0 010 8M18 5a10 10 0 010 14"/>',
  muted: '<path d="M11 5L6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  exit: '<path d="M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>'
};
function buttonIcon(id, icon, label) {
  const el = $(id);
  if (el.dataset.icon !== icon) { el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[icon] + '</svg>'; el.dataset.icon = icon; }
  el.setAttribute('aria-label', label); el.title = label;
}
buttonIcon('play', 'play', 'Play');
buttonIcon('pause', 'pause', 'Pause');
buttonIcon('step', 'step', 'Next frame');
buttonIcon('mute', 'muted', 'Unmute');
buttonIcon('fullscreen', 'fullscreen', 'Enter fullscreen');
buttonIcon('exitFullscreen', 'exit', 'Exit fullscreen');
buttonIcon('menu', 'menu', 'Settings');
buttonIcon('closeSettings', 'close', 'Close settings');
function showMessage(text) {
  clearTimeout(messageTimer);
  $('message').textContent = text; $('message').hidden = !text;
  if (text) messageTimer = setTimeout(() => { $('message').hidden = true; }, 6000);
}
function showWorkspace(show) {
  $('loading').hidden = true; $('connect').hidden = show; $('workspace').hidden = !show;
  // Tells the LiveWork Android app that the page is ready, so it can hide its loading screen.
  window.LiveWorkApp?.screen(show ? 'workspace' : 'connect');
}
const sendInput = data => { if (channel?.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify({ v: 1, revision: state.revision, ...data })); };
const resetInput = bindInput(stage, video, sendInput, () => mediaReady && state.state === 'playing' && $('contextMenu').hidden);

async function pair(code) {
  if (pairing) return;
  clearTimeout(reconnectTimer);
  pairing = true; $('connectButton').disabled = true; $('connectButton').textContent = 'Connecting…'; $('pairError').textContent = '';
  try {
    const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const body = await res.json(); if (!res.ok) throw new Error(body.error);
    $('code').value = ''; await connectControl();
  } catch (err) {
    showWorkspace(false); $('pairError').textContent = err instanceof TypeError ? 'Cannot reach LiveWork. Check the server and your Tailscale connection.' : err.message;
  } finally { pairing = false; $('connectButton').disabled = false; $('connectButton').textContent = 'Connect'; }
}
$('pairing').addEventListener('submit', e => { e.preventDefault(); pair($('code').value.trim()); });

async function connectControl() {
  clearTimeout(reconnectTimer);
  if (control && control.readyState < 2) return;
  const attempt = ++controlGeneration;
  try {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error();
    const session = await response.json();
    if (attempt !== controlGeneration) return;
    if (!session.authenticated) {
      connectedOnce = false; stopMedia(); showWorkspace(false);
      return;
    }
  } catch {
    if (attempt !== controlGeneration) return;
    if (!connectedOnce) { showWorkspace(false); $('pairError').textContent = 'Cannot reach LiveWork. Check the server and your Tailscale connection.'; }
    reconnectTimer = setTimeout(connectControl, 2000); return;
  }
  if (attempt !== controlGeneration || (control && control.readyState < 2)) return;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/control'); control = ws;
  $('status').textContent = 'connecting';
  ws.onopen = () => { connectedOnce = true; showWorkspace(true); $('pairError').textContent = ''; };
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') updateState(msg);
    else if (msg.type === 'result') {
      const action = pending.get(msg.id); pending.delete(msg.id);
      if (action?.name === 'SetResolution') {
        resolutionEdited = false;
        if (msg.ok) $('dimensions').hidden = true;
        else $('resolutionError').textContent = msg.message;
      }
      if (!msg.ok) showMessage(msg.message);
      renderControls();
    }
  };
  ws.onclose = () => {
    if (control !== ws) return;
    stopMedia(); pending.clear(); resolutionEdited = false;
    updateState({ state: 'offline', message: 'Connection lost. Reconnecting…' });
    if (!connectedOnce) {
      showWorkspace(false); $('pairError').textContent = 'Another browser may be controlling Unity. Close that tab and connect again.';
    } else reconnectTimer = setTimeout(connectControl, 2000);
  };
  ws.onerror = () => {};
}
function command(name, args = {}) {
  if (control?.readyState !== WebSocket.OPEN || pending.size) return false;
  resetInput();
  const id = Date.now() + '-' + (++requestId);
  pending.set(id, { time: Date.now(), name });
  control.send(JSON.stringify({ v: 1, type: 'command', id, command: name, ...args }));
  renderControls(); return true;
}
const running = () => state.isPlaying || ['playing', 'paused'].includes(state.state);
$('play').onclick = () => command(running() ? 'Stop' : 'Play');
$('pause').onclick = () => command(state.isPaused || state.state === 'paused' ? 'Resume' : 'Pause');
$('step').onclick = () => command('Step');
function resize(width, height) {
  $('resolutionError').textContent = '';
  if (![width, height].every(n => Number.isInteger(n) && n >= 240 && n <= 1920 && n % 2 === 0) || width * height > 2073600) {
    $('resolutionError').textContent = 'Use even sizes from 240 to 1920, up to 2,073,600 pixels.'; return;
  }
  if (command('SetResolution', { width, height })) resolutionEdited = true;
  else renderControls();
}
$('dimensions').onsubmit = e => { e.preventDefault(); resize(Number($('width').value), Number($('height').value)); };
$('preset').onchange = e => {
  const value = e.target.value;
  $('dimensions').hidden = value !== 'custom'; $('resolutionError').textContent = '';
  if (value === 'custom') {
    $('width').value = state.width || 1280; $('height').value = state.height || 720; $('width').focus(); return;
  }
  if (value !== 'current') resize(...value.split('x').map(Number));
};
$('qualities').onchange = e => {
  if (e.target.name === 'quality' && !command('SetStreamQuality', { quality: e.target.value })) renderControls();
};
function choose(name, value) { for (const input of document.getElementsByName(name)) input.checked = input.value === value; }
function showSettings(show) {
  if (show === !$('settings').hidden) return;
  resetInput();
  $('settings').hidden = !show; $('menu').setAttribute('aria-expanded', String(show));
  if (show) $('settings').querySelector('.sheet').focus();
  else { $('dimensions').hidden = true; resolutionEdited = false; renderControls(); $('menu').focus(); }
}
$('menu').onclick = () => showSettings(true);
$('closeSettings').onclick = () => showSettings(false);
$('settings').addEventListener('pointerdown', e => { if (e.target === $('settings')) showSettings(false); });
$('mute').onclick = async () => {
  video.muted = !video.muted;
  buttonIcon('mute', video.muted ? 'muted' : 'sound', video.muted ? 'Unmute' : 'Mute');
  $('mute').setAttribute('aria-pressed', String(video.muted));
  if (video.srcObject) await video.play().catch(() => showMessage('Audio playback was blocked. Tap Unmute to try again.'));
};
async function fullscreen() {
  resetInput();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stage.requestFullscreen) await stage.requestFullscreen();
    else throw new Error();
  } catch { showMessage('Fullscreen is unavailable in this browser.'); }
}
$('fullscreen').onclick = fullscreen; $('exitFullscreen').onclick = fullscreen;
document.addEventListener('fullscreenchange', () => { $('exitFullscreen').hidden = document.fullscreenElement !== stage; resetInput(); });
stage.addEventListener('contextmenu', e => {
  e.preventDefault(); resetInput();
  if (window.matchMedia('(pointer: fine)').matches && stage.requestPointerLock) {
    $('contextMenu').hidden = false; $('lock').focus();
  }
});
$('lock').onclick = async () => {
  $('contextMenu').hidden = true;
  try { stage.focus(); await stage.requestPointerLock(); }
  catch { showMessage('Pointer lock is unavailable. Try a supported desktop browser over HTTPS.'); }
};
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#contextMenu')) $('contextMenu').hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('contextMenu').hidden = true; showSettings(false); }
});
function renderControls() {
  const active = running(), paused = state.isPaused || state.state === 'paused';
  const ready = control?.readyState === WebSocket.OPEN && !['offline', 'reloading'].includes(state.state) && !pending.size;
  buttonIcon('play', active ? 'stop' : 'play', active ? 'Stop' : 'Play');
  $('play').disabled = !ready; $('play').setAttribute('aria-pressed', String(Boolean(active)));
  buttonIcon('pause', 'pause', paused ? 'Resume' : 'Pause');
  $('pause').disabled = !ready || !active; $('pause').setAttribute('aria-pressed', String(Boolean(paused)));
  $('step').disabled = !ready || !paused || !active;
  for (const input of $('settings').querySelectorAll('input[type="radio"]')) input.disabled = !ready;
  $('preset').disabled = !ready; $('resize').disabled = !ready;
  if (state.quality) choose('quality', state.quality);
  if (state.width) {
    const size = state.width + 'x' + state.height;
    $('currentOption').textContent = state.width + ' × ' + state.height + ' · Custom';
    if (!resolutionEdited && $('dimensions').hidden) $('preset').value = [...$('preset').options].some(o => o.value === size) ? size : 'current';
  }
}
function updateState(next) {
  if (next.revision !== state.revision || next.state !== 'playing') resetInput();
  const previousMessage = state.message;
  state = next;
  $('status').textContent = state.state || 'connecting'; $('status').dataset.state = state.state;
  renderControls();
  // The overlay already shows the message of these states; a toast would repeat it.
  const overlayMessage = ['offline', 'reloading', 'error'].includes(state.state);
  if (state.message !== previousMessage) showMessage(overlayMessage ? '' : state.message || '');
  $('overlay').hidden = mediaReady && ['playing', 'paused'].includes(state.state);
  $('overlay').dataset.busy = String(state.state !== 'stopped' && state.state !== 'error');
  $('overlayText').textContent = state.state === 'playing' || state.state === 'paused' ? 'Starting video…' : state.state === 'stopped' ? 'Press Play to start' : state.state === 'reloading' ? (state.message || 'Unity is reloading scripts…') : state.state === 'error' ? (state.message || 'Check the Unity Console') : (state.message || 'Waiting for Unity…');
  if (!running() || !state.streaming) { stopMedia(); return; }
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
    // Play frames as soon as they arrive instead of buffering for smoothness.
    if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0;
    else if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0;
    video.play().catch(() => showMessage('Video playback was blocked. Tap Unmute to start it.'));
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
  video.srcObject = null;
}
function retryMedia() {
  stopMedia(); mediaTimer = setTimeout(() => { mediaTimer = undefined; startMedia(); }, 2000);
}
video.addEventListener('playing', () => { mediaReady = true; canvas.hidden = true; updateState(state); });
setInterval(() => {
  sendInput({ type: 'heartbeat' });
  for (const [id, action] of pending) if (Date.now() - action.time > 22000) {
    pending.delete(id); resolutionEdited = false; renderControls();
    showMessage('No confirmation received. Check the Editor before retrying.');
  }
}, 500);
window.addEventListener('pagehide', () => { resetInput(); control?.close(); stopMedia(); });
function consumeQrCode() {
  const qrCode = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (qrCode === null) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (/^[0-9]{6}$/.test(qrCode)) pair(qrCode);
  else $('pairError').textContent = 'This QR code is invalid. Enter the code shown in LiveWork.';
  return true;
}
window.addEventListener('hashchange', consumeQrCode);
if (!consumeQrCode()) connectControl();
