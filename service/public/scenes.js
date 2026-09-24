const groups = [['build', 'In Build Settings'], ['assets', 'Assets'], ['packages', 'Packages']];
const groupOf = scene => scene.inBuild ? 'build' : scene.path.startsWith('Packages/') ? 'packages' : 'assets';
const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };

/** Renders the scene picker. select(path) and restart(path) send a command and return true when it was sent. */
export function bindScenes({ list, search, empty, hint, select, restart }) {
  let scenes = [], truncated = false, received = false, running = false, active = '', current = '', ready = false, confirming = '', key = '';
  function render(force) {
    const query = search.value.trim().toLowerCase();
    const next = [received, running, active, current, ready, confirming, query].join('\n');
    if (!force && next === key) return;
    key = next;
    const shown = scenes.filter(s => !query || s.name.toLowerCase().includes(query) || s.path.toLowerCase().includes(query));
    list.replaceChildren();
    for (const [group, title] of groups) {
      const items = shown.filter(s => groupOf(s) === group);
      if (!items.length) continue;
      list.append(element('h3', 'group', title + ' · ' + items.length));
      for (const scene of items) list.append(row(scene));
    }
    hint.textContent = running ? 'Tap a scene to restart the game in it.' : 'Tap a scene to make it current, then press Play.';
    empty.hidden = shown.length > 0;
    empty.textContent = !received ? 'Waiting for the scene list from Unity…' : scenes.length ? 'No scenes match your search.' : 'This project has no scenes.';
    if (truncated) list.append(element('p', 'empty', 'Only the first ' + scenes.length + ' scenes are listed. Search to find others.'));
  }
  function row(scene) {
    const item = element('div', 'scene'), isRunning = running && scene.path === active, isCurrent = scene.path === current;
    const button = element('button', 'scene-row');
    button.disabled = !ready; button.dataset.path = scene.path;
    const label = element('span', 'scene-text');
    label.append(element('span', 'scene-name', scene.name), element('span', 'scene-path', scene.path));
    button.append(label);
    if (isRunning) button.append(element('span', 'tag', 'Running'));
    if (isCurrent && !isRunning) button.append(element('span', 'tag current', 'Current'));
    if (isCurrent || isRunning) button.setAttribute('aria-current', 'true');
    button.setAttribute('aria-label', (running ? 'Restart in ' : 'Select ') + scene.name);
    button.onclick = () => {
      if (!running) { if (!isCurrent) select(scene.path); return; }
      confirming = scene.path; render(); list.querySelector('.confirm .primary')?.focus();
    };
    item.append(button);
    if (confirming === scene.path && running) {
      const confirm = element('div', 'confirm');
      confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', 'Restart in ' + scene.name);
      const yes = element('button', 'primary', 'Restart'), no = element('button', '', 'Cancel');
      yes.disabled = !ready;
      yes.onclick = () => { if (restart(scene.path)) confirming = ''; render(); };
      no.onclick = () => { confirming = ''; render(); list.querySelector(`[data-path="${CSS.escape(scene.path)}"]`)?.focus(); };
      confirm.append(element('span', '', 'Stop the game and restart in this scene?'), yes, no);
      item.append(confirm);
    }
    return item;
  }
  search.addEventListener('input', () => render());
  return {
    update(message) { scenes = message.scenes; truncated = message.truncated; received = true; render(true); },
    setState(state, canCommand) {
      running = Boolean(state.isPlaying || ['playing', 'paused'].includes(state.state)); active = state.scene || ''; current = state.startScene || ''; ready = canCommand;
      if (!running) confirming = '';
      render();
    },
    cancel() { if (confirming) { confirming = ''; render(); } }
  };
}
