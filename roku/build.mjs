#!/usr/bin/env node
// Build the sideloadable Nightscape screensaver zip.
//
//   node roku/build.mjs
//   FRAMES_URL=https://example.com/nightscape/ node roku/build.mjs
//
// Artwork is cropped from roku/channel/images/source.jpg, a real Nightscape frame.
// The video is not inside the zip: a screensaver package cannot hold it, and a
// screensaver is not allowed to play video. Point FRAMES_URL at the hosted frames/.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL = path.join(ROOT, 'channel');
const DIST = path.join(ROOT, 'dist');
const STAGING = path.join(DIST, 'package');
const ZIP = path.join(DIST, 'nightscape-screensaver.zip');
const SOURCE = path.join(CHANNEL, 'images', 'source.jpg');

// 540x405 is an odd height, which baseline JPEG cannot store, so that icon is PNG.
const ART = [
  ['icon_fhd.png', 540, 405, 'png', null],
  ['icon_hd.jpg', 290, 218, 'jpg', '4'],
  ['icon_sd.jpg', 214, 144, 'jpg', '4'],
  ['splash_fhd.jpg', 1920, 1080, 'jpg', '5'],
  ['splash_hd.jpg', 1280, 720, 'jpg', '4'],
  ['splash_sd.jpg', 720, 480, 'jpg', '4'],
  ['fallback.jpg', 1280, 720, 'jpg', '3']
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} exited ${r.status}\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return r;
}

function dimensions(file) {
  const r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file
  ]);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}

function renderArtwork() {
  if (!fs.existsSync(SOURCE)) throw new Error(`missing artwork source ${SOURCE}`);
  const images = path.join(CHANNEL, 'images');
  for (const [name, w, h, kind, quality] of ART) {
    const dest = path.join(images, name);
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', SOURCE,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
      '-frames:v', '1', '-update', '1'
    ];
    if (kind === 'jpg') args.push('-q:v', quality || '3');
    args.push(dest);
    run('ffmpeg', args);
    const got = dimensions(dest);
    if (got.w !== w || got.h !== h) throw new Error(`${name} is ${got.w}x${got.h}, expected ${w}x${h}`);
  }
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'source.jpg') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function injectUrl(configText, url) {
  if (url.includes('"') || url.includes('\n') || url.includes('\r')) {
    throw new Error('FRAMES_URL cannot contain quotes or newlines');
  }
  const marker = 'return "" \' FRAMES_URL';
  if (!configText.includes(marker)) throw new Error('config.brs is missing the FRAMES_URL marker');
  return configText.replace(marker, `return "${url}" ' FRAMES_URL`);
}

function parseManifest(text) {
  const fields = {};
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) throw new Error(`bad manifest line: ${line}`);
    fields[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return fields;
}

function verify(zipPath) {
  const listed = run('unzip', ['-Z1', zipPath]).stdout.split(/\n/).filter(Boolean);
  const required = [
    'manifest',
    'source/main.brs',
    'source/config.brs',
    'components/NightscapeScreen.xml',
    'components/NightscapeScreen.brs',
    'components/NightscapeSettings.xml',
    'components/NightscapeSettings.brs',
    'images/icon_fhd.png',
    'images/icon_hd.jpg',
    'images/icon_sd.jpg',
    'images/splash_fhd.jpg',
    'images/splash_hd.jpg',
    'images/splash_sd.jpg',
    'images/fallback.jpg'
  ];
  for (const name of required) {
    if (!listed.includes(name)) throw new Error(`zip is missing ${name}`);
  }
  if (listed.some(name => name.startsWith('/') || name.split('/').includes('..') || name.startsWith('channel/'))) {
    throw new Error('zip paths must be relative to the package root');
  }
  if (listed.includes('images/source.jpg')) throw new Error('source.jpg should not be in the package');

  const checkDir = path.join(DIST, 'package-check');
  fs.rmSync(checkDir, { recursive: true, force: true });
  run('unzip', ['-q', zipPath, '-d', checkDir]);
  const manifest = parseManifest(fs.readFileSync(path.join(checkDir, 'manifest'), 'utf8'));
  for (const key of ['title', 'major_version', 'minor_version', 'build_version', 'screensaver_title', 'ui_resolutions', 'mm_icon_focus_fhd', 'mm_icon_focus_hd', 'splash_screen_hd', 'splash_color']) {
    if (!manifest[key]) throw new Error(`manifest is missing ${key}`);
  }
  if (manifest.screensaver_title !== 'Nightscape') throw new Error('screensaver_title must be Nightscape');
  const main = fs.readFileSync(path.join(checkDir, 'source/main.brs'), 'utf8');
  const mainCode = main.replace(/'[^\n]*/g, '');
  if (!/sub\s+RunScreenSaver\s*\(/.test(mainCode)) throw new Error('RunScreenSaver entry is missing');
  if (!/sub\s+RunScreenSaverSettings\s*\(/.test(mainCode)) throw new Error('RunScreenSaverSettings entry is missing');
  if (/sub\s+Main\s*\(|function\s+Main\s*\(/.test(mainCode)) throw new Error('a screensaver must not define Main()');
  const xml = fs.readdirSync(path.join(checkDir, 'components')).filter(name => name.endsWith('.xml')).map(name => fs.readFileSync(path.join(checkDir, 'components', name), 'utf8')).join('\n');
  const brs = fs.readdirSync(path.join(checkDir, 'components')).filter(name => name.endsWith('.brs')).map(name => fs.readFileSync(path.join(checkDir, 'components', name), 'utf8')).join('\n').replace(/'[^\n]*/g, '');
  if (/<Video[\s>]/.test(xml) || /roVideoPlayer|roVideoScreen/.test(mainCode + brs)) {
    throw new Error('the screensaver must not play video');
  }
  for (const [name, w, h] of ART) {
    const got = dimensions(path.join(checkDir, 'images', name));
    if (got.w !== w || got.h !== h) throw new Error(`packaged ${name} is ${got.w}x${got.h}`);
  }
  const bytes = fs.statSync(zipPath).size;
  fs.rmSync(checkDir, { recursive: true, force: true });
  return { bytes, entries: listed.length, framesUrl: /return "([^"]*)" ' FRAMES_URL/.exec(fs.readFileSync(path.join(STAGING, 'source/config.brs'), 'utf8'))?.[1] ?? '' };
}

if (!fs.existsSync(SOURCE)) {
  console.error(`Missing ${SOURCE}. Capture a frame or restore the bundled Nightscape still.`);
  process.exit(1);
}

renderArtwork();
fs.rmSync(STAGING, { recursive: true, force: true });
copyTree(CHANNEL, STAGING);
const url = process.env.FRAMES_URL || '';
const configPath = path.join(STAGING, 'source/config.brs');
fs.writeFileSync(configPath, injectUrl(fs.readFileSync(configPath, 'utf8'), url));
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(DIST, { recursive: true });
run('zip', ['-r', '-X', ZIP, '.'], { cwd: STAGING });
const result = verify(ZIP);
const mb = result.bytes / (1024 * 1024);
console.log(`wrote ${path.relative(path.resolve(ROOT, '..'), ZIP)} (${result.bytes} bytes, ${result.entries} files)`);
if (mb > 3.5) console.log(`warning: package is ${mb.toFixed(2)} MB. Sideload often fails above about 2–4 MB.`);
else if (result.bytes > 500 * 1024) console.log('note: the installer may warn that the package is over the 500 KB recommendation. It should still install.');
console.log(result.framesUrl ? `built-in frames URL: ${result.framesUrl}` : 'no frames URL baked in. Set one in screensaver settings, or rebuild with FRAMES_URL.');
