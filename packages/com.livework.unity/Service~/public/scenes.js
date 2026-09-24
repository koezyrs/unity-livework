const groups = [['build', 'In Build Settings'], ['assets', 'Assets'], ['packages', 'Packages']];
const groupOf = scene => scene.inBuild ? 'build' : scene.path.startsWith('Packages/') ? 'packages' : 'assets';
const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };

/** Renders the scene picker. play(path) sends the command and returns true when it was sent. */
export function bindScenes({ list, search, empty, play }) {
  let scenes = [], truncated = false, received = false, running = false, current = '', ready = false, confirming = '', key = '';
  function render(force) {
    const query = search.value.trim().toLowerCase();
    const next = [received, running, current, ready, confirming, query].join('\n');
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
    empty.hidden = shown.length > 0;
    empty.textContent = !received ? 'Waiting for the scene list from Unity…' : scenes.length ? 'No scenes match your search.' : 'This project has no scenes.';
    if (truncated) list.append(element('p', 'empty', 'Only the first ' + scenes.length + ' scenes are listed. Search to find others.'));
  }
  function row(scene) {
    const item = element('div', 'scene'), active = running && scene.path === current;
    const button = element('button', 'scene-row');
    button.disabled = !ready; button.dataset.path = scene.path;
    const label = element('span', 'scene-text');
    label.append(element('span', 'scene-name', scene.name), element('span', 'scene-path', scene.path));
    button.append(label);
    if (active) button.append(element('span', 'tag', 'Running'));
    button.setAttribute('aria-label', (active ? 'Restart ' : 'Play ') + scene.name);
    button.onclick = () => {
      if (!running) { play(scene.path); return; }
      confirming = scene.path; render(); list.querySelector('.confirm .primary')?.focus();
    };
    item.append(button);
    if (confirming === scene.path && running) {
      const confirm = element('div', 'confirm');
      confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', 'Restart in ' + scene.name);
      const yes = element('button', 'primary', 'Restart'), no = element('button', '', 'Cancel');
      yes.disabled = !ready;
      yes.onclick = () => { if (play(scene.path)) confirming = ''; render(); };
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
      running = Boolean(state.isPlaying || ['playing', 'paused'].includes(state.state)); current = state.scene || ''; ready = canCommand;
      if (!running) confirming = '';
      render();
    },
    cancel() { if (confirming) { confirming = ''; render(); } }
  };
}
