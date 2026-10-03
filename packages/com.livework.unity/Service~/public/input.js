export function contentRect(rect, width, height) {
  const scale = Math.min(rect.width / width, rect.height / height);
  return { left: rect.left + (rect.width - width * scale) / 2, top: rect.top + (rect.height - height * scale) / 2, width: width * scale, height: height * scale };
}
export function pointInVideo(clientX, clientY, rect, width, height, clamp = false) {
  if (!width || !height || !rect.width || !rect.height) return null;
  const r = contentRect(rect, width, height), x = (clientX - r.left) / r.width, y = (clientY - r.top) / r.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

// The reliable input channel shares congestion with video. Merged moves may be
// shed while the send buffer is full, but a boundary (down/up, key, reset) must
// always land: a dropped began or ended strands a gesture in the game.
export function inputGate(open, transmit, limit = 65536) {
  let paused = false;
  return {
    attach: ch => {
      paused = false;
      if (!ch) return;
      ch.bufferedAmountLowThreshold = limit / 2;
      ch.onbufferedamountlow = () => { paused = false; };
    },
    resume: () => { paused = false; },
    send: (data, boundary = false) => {
      const ch = open();
      if (!ch || ch.readyState !== 'open') return;
      if (!boundary && (paused || ch.bufferedAmount >= limit)) { if (ch.bufferedAmount >= limit) paused = true; return; }
      transmit(ch, data);
    }
  };
}

export function bindInput(stage, video, sendNow, enabled) {
  const fingers = new Map(); let mouseButtons = 0;
  // Moves are merged and sent once per display frame, so a fast pointer does not flood the
  // reliable data channel. Every other message flushes pending moves first to keep order.
  const moves = new Map(); let frame = 0;
  const flush = () => { cancelAnimationFrame(frame); frame = 0; for (const message of moves.values()) sendNow(message); moves.clear(); };
  // Boundaries travel immediately and must not be shed under congestion; moves may.
  const send = (message, boundary = false) => { flush(); sendNow(message, boundary); };
  function move(key, message) {
    const previous = moves.get(key);
    if (previous && previous.buttons !== message.buttons) flush();
    else if (previous && message.type === 'mouse') { message.dx += previous.dx; message.dy += previous.dy; }
    moves.set(key, message);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  const reset = () => { moves.clear(); flush(); fingers.clear(); mouseButtons = 0; send({ type: 'reset' }, true); };
  const point = (e, clamp) => pointInVideo(e.clientX, e.clientY, stage.getBoundingClientRect(), video.videoWidth, video.videoHeight, clamp);
  function pointer(e, phase) {
    if (!enabled() || e.target.closest('button,form,input,select')) return;
    // Clamp a start just outside the video (letterbox bars, notch edges) into the
    // rect instead of swallowing the whole gesture.
    const p = point(e, true); if (!p) return;
    e.preventDefault();
    if (phase === 'began') { stage.focus({ preventScroll: true }); stage.setPointerCapture(e.pointerId); }
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (phase === 'began') {
        const used = new Set(fingers.values()); let id = 1; while (used.has(id)) id++;
        if (id > 10) return; fingers.set(e.pointerId, id);
      }
      const id = fingers.get(e.pointerId); if (!id) return;
      if (phase === 'moved') move(id, { type: 'touch', id, phase, ...p });
      else send({ type: 'touch', id, phase, ...p }, true);
      if (phase === 'ended' || phase === 'canceled') fingers.delete(e.pointerId);
    } else {
      // DOM and Input System use left=1, right=2, middle=4.
      mouseButtons = phase === 'canceled' ? 0 : e.buttons;
      const r = contentRect(stage.getBoundingClientRect(), video.videoWidth, video.videoHeight);
      const message = { type: 'mouse', ...p, buttons: mouseButtons, locked: document.pointerLockElement === stage, dx: e.movementX / r.width, dy: e.movementY / r.height, scroll: 0 };
      if (phase === 'moved') move('mouse', message); else send(message, true);
    }
  }
  stage.addEventListener('pointerdown', e => pointer(e, 'began'));
  stage.addEventListener('pointermove', e => pointer(e, 'moved'));
  stage.addEventListener('pointerup', e => pointer(e, 'ended'));
  stage.addEventListener('pointercancel', e => pointer(e, 'canceled'));
  stage.addEventListener('lostpointercapture', e => { if (fingers.has(e.pointerId)) pointer(e, 'canceled'); });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => {
    if (!enabled() || e.target.closest('button,form,input,select')) return; const p = point(e, false); if (!p) return; e.preventDefault();
    send({ type: 'mouse', ...p, buttons: mouseButtons, scroll: e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1) }, true);
  }, { passive: false });
  for (const type of ['keydown', 'keyup']) stage.addEventListener(type, e => {
    if (!enabled() || e.target !== stage || e.repeat) return;
    if (e.code !== 'Escape') e.preventDefault();
    send({ type: 'key', code: e.code, down: type === 'keydown' }, true);
  });
  stage.addEventListener('blur', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  document.addEventListener('pointerlockchange', reset);
  return reset;
}
