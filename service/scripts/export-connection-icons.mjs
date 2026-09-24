// Generates the connection mode icons for the Unity LiveWork window.
// Run: npm run brand (needs Microsoft Edge for PNG export).
// Tailscale and ZeroTier marks come from Simple Icons 16.32.0 (CC0 1.0). The names and
// logos are trademarks of their owners and are used only to identify each network.
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const unityIcons = join(root, 'packages/com.livework.unity/Editor/Icons');

const tile = fill => `<rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="${fill}"/>`;
const icons = [
  {
    name: 'Lan', guid: 'a0570b1b0b1851389ccbdff5e277c01f',
    // A simple network glyph: one node linked to two nodes, on a blue tile.
    body: tile('#2f80ed') + '<g fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="4.5" width="6" height="4.5" rx="1"/><rect x="4" y="15" width="6" height="4.5" rx="1"/><rect x="14" y="15" width="6" height="4.5" rx="1"/>' +
      '<path d="M12 9v3M7 15v-3h10v3"/></g>',
  },
  {
    name: 'Tailscale', guid: '690215d1a3bf0f94302ed7a576a9eddc',
    // The dark mark sits on a white tile so it reads on both Editor skins.
    body: tile('#ffffff') + '<g transform="translate(4 4) scale(0.6667)"><path fill="#242424" d="M24 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-9 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm0-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6-6a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 24a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm18 .5a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm9-9a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-3 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 3a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 5.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></g>',
  },
  {
    name: 'ZeroTier', guid: '87cfccbf2f492b6f4a93787b0c36e529',
    body: '<path fill="#ffb441" d="M4.01 0A3.999 3.999 0 0 0 .014 4v16c0 2.209 1.79 4 3.996 4h15.98a3.998 3.998 0 0 0 3.996-4V4c0-2.209-1.79-4-3.996-4zm-.672 2.834h17.326a.568.568 0 1 1 0 1.137h-8.129c.021.059.033.123.033.19v1.804A6.06 6.06 0 0 1 18.057 12c0 3.157-2.41 5.75-5.489 6.037v2.56a.568.568 0 1 1-1.136 0v-2.56A6.061 6.061 0 0 1 5.943 12a6.06 6.06 0 0 1 5.489-6.035V4.16c0-.066.012-.13.033-.19H3.338a.568.568 0 1 1 0-1.136zm8.094 4.307A4.89 4.89 0 0 0 7.113 12a4.89 4.89 0 0 0 4.319 4.86zm1.136 0v9.718A4.892 4.892 0 0 0 16.888 12a4.892 4.892 0 0 0-4.32-4.86z"/>',
  },
];

const textureMeta = guid => `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
  isReadable: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  textureType: 2
  textureShape: 1
  userData:
  assetBundleName:
  assetBundleVariant:
`;

const size = 32;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: size, height: size });
for (const icon of icons) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${icon.body}</svg>`;
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}</style>` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">`);
  await page.screenshot({ path: join(unityIcons, `${icon.name}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(join(unityIcons, `${icon.name}.png.meta`), textureMeta(icon.guid));
}
await browser.close();
console.log('Connection mode icons written.');
