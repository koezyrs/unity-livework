import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(root, '../packages/com.livework.unity/Service~');
const files = new Map();
async function collect(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative + '/' + entry.name;
    if (entry.isDirectory()) await collect(name);
    else files.set(name, (await readFile(path.join(root, name), 'utf8')).replaceAll('\r\n', '\n'));
  }
}
await collect('public');
files.set('server.mjs', (await readFile(path.join(root, 'server.mjs'), 'utf8')).replaceAll('\r\n', '\n'));
files.set('generated/signaling.cjs', (await readFile(path.join(root, 'generated/signaling.cjs'), 'utf8')).replaceAll('\r\n', '\n'));
files.set('upstream-LICENSE.md', (await readFile(path.join(root, 'upstream/LICENSE.md'), 'utf8')).replaceAll('\r\n', '\n'));
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = { name: source.name, version: source.version, private: true, type: 'module', engines: source.engines, scripts: { start: 'node server.mjs' }, dependencies: source.dependencies };
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
delete lock.packages[''].devDependencies;
for (const [name, value] of Object.entries(lock.packages)) if (value.dev) delete lock.packages[name];
files.set('package.json', JSON.stringify(manifest, null, 2) + '\n');
files.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
const digest = createHash('sha256');
for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) digest.update(name + '\0' + content + '\0');
files.set('bundle.sha256', digest.digest('hex') + '\n');
for (const [name, content] of files) {
  const filename = path.join(target, name);
  if (process.argv.includes('--check')) {
    let actual;
    try { actual = (await readFile(filename, 'utf8')).replaceAll('\r\n', '\n'); } catch {}
    if (actual !== content) throw new Error('Service bundle is stale: ' + name + '. Run npm run build in service.');
  } else {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
}
console.log(process.argv.includes('--check') ? 'Git package service bundle verified.' : 'Git package service bundle updated.');
