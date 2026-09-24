// Generates every LiveWork logo file from one geometry source.
// Run: npm run brand (needs Microsoft Edge for PNG export).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const brandDir = join(root, 'docs/brand');
const androidRes = join(root, 'android/app/src/main/res');
const unityIcons = join(root, 'packages/com.livework.unity/Editor/Icons');

// ---------- Geometry (128 x 128 design space) ----------

const round = (n) => Math.round(n * 100) / 100;
const fmt = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('') + 'Z';

// The cube is scaled around the tile center, so it stays centered.
const cubeScale = 0.78;
const cubeOffset = 64 - 64 * cubeScale;
const place = ([x, y]) => [x * cubeScale + cubeOffset, y * cubeScale + cubeOffset];

const T = [64, 16], UR = [105.6, 40], C = [64, 64], UL = [22.4, 40];
const LR = [105.6, 88], B = [64, 112], LL = [22.4, 88];

// Maps a point in a 0..100 face space onto a cube face.
const face = (origin, u, v) => ([x, y]) => [
  origin[0] + (u[0] - origin[0]) * x / 100 + (v[0] - origin[0]) * y / 100,
  origin[1] + (u[1] - origin[1]) * x / 100 + (v[1] - origin[1]) * y / 100,
];
const leftFace = face(UL, C, LL);
const rightFace = face(C, UR, B);

// Outline of a polyline stroke with miter joins and butt caps.
function strokeOutline(points, width) {
  const h = width / 2;
  const normals = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy);
    normals.push([-dy / len, dx / len]);
  }
  const side = (sign) => points.map((p, i) => {
    if (i === 0) return [p[0] + normals[0][0] * h * sign, p[1] + normals[0][1] * h * sign];
    if (i === points.length - 1) {
      const n = normals[i - 1];
      return [p[0] + n[0] * h * sign, p[1] + n[1] * h * sign];
    }
    const a = normals[i - 1], b = normals[i];
    const mx = a[0] + b[0], my = a[1] + b[1];
    const mlen = Math.hypot(mx, my);
    const m = [mx / mlen, my / mlen];
    const miter = h / (m[0] * b[0] + m[1] * b[1]);
    return [p[0] + m[0] * miter * sign, p[1] + m[1] * miter * sign];
  });
  return [...side(1), ...side(-1).reverse()];
}

const letterL = strokeOutline([[32, 20], [32, 76], [78, 76]], 12).map(leftFace).map(place);
const letterW = strokeOutline([[16, 20], [33, 78], [50, 42], [67, 78], [84, 20]], 11).map(rightFace).map(place);
const topFace = [T, UR, C, UL].map(place);
const leftFacePts = [UL, C, B, LL].map(place);
const rightFacePts = [C, UR, LR, B].map(place);
const play = [[45.3, 38.8], [66.1, 50.8], [74.4, 34]].map(place);
const edges = [UL, C, UR].map(place);
const edgeDown = [C, B].map(place);

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
};
const diagonal = (pts, stops) => { const b = bbox(pts); return { ...b, stops }; };
const vertical = (pts, stops) => { const b = bbox(pts); return { x1: b.x1, y1: b.y1, x2: b.x1, y2: b.y2, stops }; };

const accent = [[0, '#ff6a4d'], [1, '#ff2d55']];
const arcs = [
  'M97 32.5a12.5 12.5 0 0 1 12.5 12.5',
  'M97 22a23 23 0 0 1 23 23',
];

// Shapes of the logo without the tile.
function markShapes({ mono = false } = {}) {
  if (mono) {
    // Monochrome launcher icons use alpha only: letters and play are holes.
    const hole = (outer, inner) => fmt(outer) + fmt(inner);
    return [
      { d: hole(topFace, play), fill: '#ffffff', evenOdd: true },
      { d: hole(leftFacePts, letterL), fill: '#ffffff', alpha: 0.75, evenOdd: true },
      { d: hole(rightFacePts, letterW), fill: '#ffffff', alpha: 0.5, evenOdd: true },
      ...arcs.map((d) => ({ d, stroke: '#ffffff', width: 5 })),
    ];
  }
  return [
    { d: fmt(topFace), fill: diagonal(topFace, [[0, '#ffffff'], [1, '#d9d9d9']]) },
    { d: fmt(leftFacePts), fill: vertical(leftFacePts, [[0, '#cfcfcf'], [1, '#9a9a9a']]) },
    { d: fmt(rightFacePts), fill: vertical(rightFacePts, [[0, '#8a8a8a'], [1, '#555555']]) },
    { d: fmt(letterL), fill: '#161616' },
    { d: fmt(letterW), fill: '#161616' },
    {
      d: fmt(edges).slice(0, -1) + fmt(edgeDown).slice(0, -1),
      stroke: '#ffffff', alpha: 0.55, width: round(1.2 * cubeScale),
    },
    { d: fmt(play), fill: diagonal(play, accent) },
    ...arcs.map((d) => ({ d, stroke: { x1: 97, y1: 22, x2: 120, y2: 45, stops: accent }, width: 5 })),
  ];
}

const tileShape = {
  d: 'M28 0H100A28 28 0 0 1 128 28V100A28 28 0 0 1 100 128H28A28 28 0 0 1 0 100V28A28 28 0 0 1 28 0Z',
  fill: { x1: 0, y1: 0, x2: 0, y2: 128, stops: [[0, '#262626'], [1, '#090909']] },
};

// ---------- SVG ----------

function toSvg(shapes, size = 128) {
  const defs = [];
  const paint = (p) => {
    if (typeof p === 'string') return p;
    const id = `g${defs.length}`;
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(p.x1)}" y1="${round(p.y1)}" x2="${round(p.x2)}" y2="${round(p.y2)}">` +
      p.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') + '</linearGradient>');
    return `url(#${id})`;
  };
  const body = shapes.map((s) => {
    const attrs = [`d="${s.d}"`];
    if (s.stroke) {
      attrs.push('fill="none"', `stroke="${paint(s.stroke)}"`, `stroke-width="${s.width}"`, 'stroke-linecap="round"', 'stroke-linejoin="round"');
      if (s.alpha !== undefined) attrs.push(`stroke-opacity="${s.alpha}"`);
    } else {
      attrs.push(`fill="${paint(s.fill)}"`);
      if (s.alpha !== undefined) attrs.push(`fill-opacity="${s.alpha}"`);
      if (s.evenOdd) attrs.push('fill-rule="evenodd"');
    }
    return `<path ${attrs.join(' ')}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128"><defs>${defs.join('')}</defs>${body}</svg>\n`;
}

// ---------- Android VectorDrawable ----------

const argb = (hex) => '#FF' + hex.slice(1).toUpperCase();

function toVector(shapes, { size, viewport, scale = 1, translate = 0 }) {
  const paint = (name, p) => {
    if (typeof p === 'string') return { attr: ` android:${name}="${argb(p)}"`, child: '' };
    const items = p.stops.map(([o, c]) => `\n                    <item android:offset="${o}" android:color="${argb(c)}" />`).join('');
    return {
      attr: '',
      child: `\n        <aapt:attr name="android:${name}">\n            <gradient\n                android:type="linear"\n` +
        `                android:startX="${round(p.x1)}" android:startY="${round(p.y1)}"\n` +
        `                android:endX="${round(p.x2)}" android:endY="${round(p.y2)}">${items}\n            </gradient>\n        </aapt:attr>`,
    };
  };
  const paths = shapes.map((s) => {
    let attrs = `\n        android:pathData="${s.d}"`;
    let child = '';
    if (s.stroke) {
      const p = paint('strokeColor', s.stroke);
      attrs += p.attr + `\n        android:strokeWidth="${s.width}"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round"`;
      if (s.alpha !== undefined) attrs += `\n        android:strokeAlpha="${s.alpha}"`;
      child = p.child;
    } else {
      const p = paint('fillColor', s.fill);
      attrs += p.attr;
      if (s.alpha !== undefined) attrs += `\n        android:fillAlpha="${s.alpha}"`;
      if (s.evenOdd) attrs += '\n        android:fillType="evenOdd"';
      child = p.child;
    }
    return child ? `    <path${attrs}>${child}\n    </path>` : `    <path${attrs} />`;
  });
  const inner = scale === 1 && translate === 0
    ? paths.join('\n')
    : `    <group\n        android:scaleX="${scale}" android:scaleY="${scale}"\n        android:translateX="${translate}" android:translateY="${translate}">\n` +
      paths.map((p) => p.replace(/^/gm, '    ')).join('\n') + '\n    </group>';
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by service/scripts/export-brand.mjs. Do not edit. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
${inner}
</vector>
`;
}

// ---------- PNG export ----------

const wordmarkFont = `font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif`;

function bannerHtml(logoSvg, { dark }) {
  const fg = dark ? '#f5f5f5' : '#111111';
  const muted = dark ? '#a8a8a8' : '#555555';
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  .b{width:1200px;height:300px;display:flex;align-items:center;justify-content:center;gap:40px;${wordmarkFont}}
  .t h1{margin:0;font-size:104px;font-weight:600;letter-spacing:-3px;color:${fg};line-height:1}
  .t p{margin:14px 0 0 4px;font-size:30px;color:${muted}}
  </style><div class="b"><img src="data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}" width="200" height="200">
  <div class="t"><h1>LiveWork</h1><p>Play your Unity Game View on your phone</p></div></div>`;
}

function socialHtml(logoSvg) {
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0}
  .s{width:1280px;height:640px;box-sizing:border-box;padding:0 110px;display:flex;align-items:center;gap:64px;
     background:radial-gradient(circle at 25% 40%,#2a2a2a 0,#0b0b0b 60%);${wordmarkFont};color:#f5f5f5}
  h1{margin:0;font-size:112px;font-weight:600;letter-spacing:-3px;line-height:1}
  p{margin:20px 0 0;font-size:34px;color:#b5b5b5;line-height:1.35}
  .tags{margin-top:34px;display:flex;gap:12px}
  .tags span{border:1px solid #3a3a3a;border-radius:999px;padding:8px 18px;font-size:22px;color:#d4d4d4}
  </style><div class="s"><img src="data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}" width="300" height="300">
  <div><h1>LiveWork</h1><p>Stream the Unity Editor Game View<br>to your phone and play it live.</p>
  <div class="tags"><span>Unity 6</span><span>WebRTC</span><span>Android</span><span>Tailscale</span></div></div></div>`;
}

async function renderPng(page, html, path, { width, height, transparent = true }) {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
}

const svgPage = (svg, size) => `<!doctype html><style>html,body{margin:0;background:transparent}</style>` +
  `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">`;

// ---------- Unity texture meta ----------

const textureMeta = (guid) => `fileFormatVersion: 2
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

// ---------- Main ----------

const logoSvg = toSvg([tileShape, ...markShapes()]);
const markSvg = toSvg(markShapes());

await mkdir(brandDir, { recursive: true });
await mkdir(unityIcons, { recursive: true });
await mkdir(join(androidRes, 'mipmap-anydpi-v26'), { recursive: true });

await writeFile(join(brandDir, 'logo.svg'), logoSvg);
await writeFile(join(brandDir, 'logo-mark.svg'), markSvg);
await writeFile(join(root, 'service/public/favicon.svg'), logoSvg);

// Android: in-app logo and adaptive launcher icon (108 x 108 viewport, 72 dp visible area).
await writeFile(join(androidRes, 'drawable/logo.xml'), toVector([tileShape, ...markShapes()], { size: 72, viewport: 128 }));
const launcher = { size: 108, viewport: 108, scale: 0.5, translate: 22 };
await writeFile(join(androidRes, 'drawable/ic_launcher_foreground.xml'), toVector(markShapes(), launcher));
await writeFile(join(androidRes, 'drawable/ic_launcher_monochrome.xml'), toVector(markShapes({ mono: true }), launcher));
await writeFile(join(androidRes, 'drawable/ic_launcher_background.xml'), toVector([
  { d: 'M0 0H108V108H0Z', fill: { x1: 0, y1: 0, x2: 0, y2: 108, stops: [[0, '#262626'], [1, '#090909']] } },
], { size: 108, viewport: 108 }));
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;
await writeFile(join(androidRes, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive);
await writeFile(join(androidRes, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [128, 256, 512, 1024]) {
  await renderPng(page, svgPage(logoSvg, size), join(brandDir, `logo-${size}.png`), { width: size, height: size });
}
await renderPng(page, bannerHtml(logoSvg, { dark: true }), join(brandDir, 'banner-dark.png'), { width: 1200, height: 300 });
await renderPng(page, bannerHtml(logoSvg, { dark: false }), join(brandDir, 'banner-light.png'), { width: 1200, height: 300 });
await renderPng(page, socialHtml(logoSvg), join(brandDir, 'social-preview.png'), { width: 1280, height: 640, transparent: false });
// Unity window tab icon: the mark without the tile reads best on both Editor skins.
await renderPng(page, svgPage(markSvg, 32), join(unityIcons, 'LiveWork.png'), { width: 32, height: 32 });
await browser.close();

await writeFile(join(root, 'packages/com.livework.unity/Editor/Icons.meta'),
  'fileFormatVersion: 2\nguid: 3f6b0c1e8a2d4b7c9e5f1a2b3c4d5e6f\nfolderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n');
await writeFile(join(unityIcons, 'LiveWork.png.meta'), textureMeta('7a1c9e4b2d5f4e8a9b3c6d7e8f901a2b'));

console.log('Brand assets written.');
