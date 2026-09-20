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

export function bindInput(stage, video, send, enabled) {
  const fingers = new Map(); let mouseButtons = 0;
  const reset = () => { fingers.clear(); mouseButtons = 0; send({ type: 'reset' }); };
  const point = (e, clamp) => pointInVideo(e.clientX, e.clientY, stage.getBoundingClientRect(), video.videoWidth, video.videoHeight, clamp);
  function pointer(e, phase) {
    if (!enabled() || e.target.closest('button,form,input,select')) return;
    const p = point(e, phase !== 'began'); if (!p) return;
    e.preventDefault();
    if (phase === 'began') { stage.focus({ preventScroll: true }); stage.setPointerCapture(e.pointerId); }
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (phase === 'began') {
        const used = new Set(fingers.values()); let id = 1; while (used.has(id)) id++;
        if (id > 10) return; fingers.set(e.pointerId, id);
      }
      const id = fingers.get(e.pointerId); if (!id) return;
      send({ type: 'touch', id, phase, ...p });
      if (phase === 'ended' || phase === 'canceled') fingers.delete(e.pointerId);
    } else {
      // DOM and Input System use left=1, right=2, middle=4.
      mouseButtons = phase === 'canceled' ? 0 : e.buttons;
      const r = contentRect(stage.getBoundingClientRect(), video.videoWidth, video.videoHeight);
      send({ type: 'mouse', ...p, buttons: mouseButtons, locked: document.pointerLockElement === stage, dx: e.movementX / r.width, dy: e.movementY / r.height, scroll: 0 });
    }
  }
  stage.addEventListener('pointerdown', e => pointer(e, 'began'));
  stage.addEventListener('pointermove', e => pointer(e, 'moved'));
  stage.addEventListener('pointerup', e => pointer(e, 'ended'));
  stage.addEventListener('pointercancel', e => pointer(e, 'canceled'));
  stage.addEventListener('lostpointercapture', e => { if (fingers.has(e.pointerId)) pointer(e, 'canceled'); });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => {
    if (!enabled()) return; const p = point(e, false); if (!p) return; e.preventDefault();
    send({ type: 'mouse', ...p, buttons: mouseButtons, scroll: e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1) });
  }, { passive: false });
  for (const type of ['keydown', 'keyup']) stage.addEventListener(type, e => {
    if (!enabled() || e.target !== stage || e.repeat) return;
    if (e.code !== 'Escape') e.preventDefault();
    send({ type: 'key', code: e.code, down: type === 'keydown' });
  });
  stage.addEventListener('blur', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  document.addEventListener('pointerlockchange', reset);
  return reset;
}
