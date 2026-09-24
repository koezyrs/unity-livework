const maxEntries = 500;
// Unity rich text tags make messages hard to read as plain text.
const richText = /<\/?(?:b|i|color|size|material|quad)(?:=[^>]*)?>/gi;
export const plainText = text => text.replace(richText, '');
const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const time = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Plain HTTP pages have no Clipboard API; the old copy command still works there.
  const area = element('textarea'); area.value = text; area.setAttribute('readonly', '');
  area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select();
  let copied = false; try { copied = document.execCommand('copy'); } catch {}
  area.remove(); return copied;
}

/** Renders the log console. onError() runs when a new error arrives. */
export function bindConsole({ panel, list, empty, search, clear, jump, onError }) {
  const levels = { info: true, warning: true, error: true }, counts = { info: 0, warning: 0, error: 0 };
  let entries = [], clearedSeq = 0, following = true;
  const buttons = [...panel.querySelectorAll('.level')];
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  const visible = entry => levels[entry.level] && (!search.value || entry.search.includes(search.value.trim().toLowerCase()));
  function renderCounts() {
    for (const button of buttons) {
      const level = button.dataset.level, count = counts[level];
      button.querySelector('.count').textContent = count > 999 ? '999+' : String(count);
      button.setAttribute('aria-pressed', String(levels[level]));
      button.setAttribute('aria-label', `${level[0].toUpperCase() + level.slice(1)}: ${count} ${count === 1 ? 'log' : 'logs'}`);
    }
    empty.hidden = entries.some(visible);
    empty.textContent = entries.length ? 'No logs match the filters.' : 'No logs yet.';
  }
  function row(entry) {
    const item = element('div', 'log'); item.dataset.level = entry.level;
    const head = element('button', 'log-head'); head.setAttribute('aria-expanded', 'false');
    const mark = element('span', 'mark'); mark.setAttribute('aria-label', entry.level); mark.setAttribute('role', 'img');
    head.append(mark, element('span', 'log-message', entry.shown), element('time', 'log-time', time(entry.time)));
    const details = element('div', 'log-details'); details.hidden = true;
    const body = element('pre', '', plainText(entry.message) + (entry.stack ? '\n\n' + entry.stack.trimEnd() : ''));
    const copy = element('button', 'copy', 'Copy');
    copy.onclick = async () => {
      const copied = await copyText(entry.message + (entry.stack ? '\n' + entry.stack.trimEnd() : ''));
      if (!copied) getSelection().selectAllChildren(body);
      copy.textContent = copied ? 'Copied' : 'Copy blocked. Text is selected.';
      setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    };
    details.append(body, copy);
    head.onclick = () => { details.hidden = !details.hidden; head.setAttribute('aria-expanded', String(!details.hidden)); };
    item.append(head, details); item.hidden = !visible(entry);
    return entry.row = item;
  }
  function filter() { for (const entry of entries) entry.row.hidden = !visible(entry); renderCounts(); }
  function trim() {
    while (entries.length > maxEntries) { const old = entries.shift(); counts[old.level]--; old.row.remove(); }
  }
  for (const button of buttons) button.onclick = () => { levels[button.dataset.level] = !levels[button.dataset.level]; filter(); };
  search.addEventListener('input', filter);
  clear.onclick = () => {
    clearedSeq = entries.at(-1)?.seq ?? clearedSeq; entries = [];
    for (const level in counts) counts[level] = 0;
    list.replaceChildren(); jump.hidden = true; renderCounts();
  };
  const toEnd = () => { list.scrollTop = list.scrollHeight; following = true; jump.hidden = true; };
  jump.onclick = toEnd;
  // Hidden panels fire no scroll events, so the last choice of the user is kept.
  list.addEventListener('scroll', () => { following = atBottom(); if (following) jump.hidden = true; });
  renderCounts();
  return {
    add(message) {
      if (message.replay) {
        // A restarted service numbers logs from 1 again.
        if ((message.entries.at(-1)?.seq ?? 0) < clearedSeq) clearedSeq = 0;
        entries = []; for (const level in counts) counts[level] = 0; list.replaceChildren();
      }
      const fragment = document.createDocumentFragment();
      let error = false;
      for (const raw of message.entries) {
        if (raw.seq <= clearedSeq || entries.length && raw.seq <= entries.at(-1).seq) continue;
        const shown = plainText(raw.message).split('\n')[0] || '(empty message)';
        const entry = { ...raw, shown, search: (plainText(raw.message) + '\n' + raw.stack).toLowerCase() };
        entries.push(entry); counts[entry.level]++; fragment.append(row(entry));
        if (entry.level === 'error') error = true;
      }
      const added = fragment.childElementCount;
      list.append(fragment); trim(); renderCounts();
      if (message.replay || following) toEnd();
      else if (added) jump.hidden = false;
      if (error && !message.replay) onError();
    },
    shown() { if (following) toEnd(); }
  };
}
