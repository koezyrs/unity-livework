import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'vendor/com.unity.renderstreaming');
const destination = path.join(root, 'packages/com.livework.unity/ThirdParty/RenderStreaming');
const files = ['LICENSE.md', 'LICENSE.md.meta', 'Runtime.meta'];
async function collect(relative) {
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    const name = relative + '/' + entry.name;
    if (entry.isDirectory()) await collect(name); else files.push(name);
  }
}
await collect('Runtime');
// Give the bundled assets their own stable identity, including serialized script
// references. Unity must not rewrite GUIDs if an old installation is still loaded.
const guids = new Map();
for (const file of files.filter(name => name.endsWith('.meta'))) {
  const text = await readFile(path.join(source, file), 'utf8');
  const guid = /^guid: ([a-f0-9]{32})/m.exec(text)?.[1];
  if (guid) guids.set(guid, createHash('sha256').update('com.livework.unity/' + guid).digest('hex').slice(0, 32));
}
for (const file of files) {
  let bytes = await readFile(path.join(source, file));
  if (!file.endsWith('.dll')) {
    let text = bytes.toString().replaceAll('\r\n', '\n');
    text = text.replaceAll('Packages/com.unity.renderstreaming/', 'Packages/com.livework.unity/ThirdParty/RenderStreaming/');
    text = text.replace(/\b[a-f0-9]{32}\b/g, guid => guids.get(guid) || guid);
    bytes = Buffer.from(text);
  }
  const target = path.join(destination, file);
  if (process.argv.includes('--check')) {
    let actual;
    try { actual = await readFile(target); if (!file.endsWith('.dll')) actual = Buffer.from(actual.toString().replaceAll('\r\n', '\n')); } catch {}
    if (!actual?.equals(bytes)) throw new Error('Bundled Render Streaming is stale: ' + file);
  } else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); }
}
console.log('Bundled Render Streaming runtime ' + (process.argv.includes('--check') ? 'verified.' : 'updated.'));
