#!/usr/bin/env node
// Capture a seamlessly looping Nightscape video and the JPEG frames the Roku
// screensaver plays. Reuses tools/record.mjs (headless Chrome, one frame at a
// time) so the flight can be stepped to an exact tile boundary.
//
//   node roku/capture.mjs                  # one 256s tile, 1080p, 8 fps
//   node roku/capture.mjs --tiles 3        # 12 min 48 s, with room for an aircraft
//   node roku/capture.mjs --probe          # two stills a tile apart, prints PSNR
//   node roku/capture.mjs --4k --fps 24
//
// Needs Node 22+, Google Chrome and ffmpeg. Set CHROME if the binary is elsewhere.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loopRates, TILE_SECONDS } from './loop-period.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function opt(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  if (v == null || v.startsWith('--')) return true;
  return v;
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`Usage: node roku/capture.mjs [options]

  --tiles N         World tiles to record (default 1). Each tile is ${TILE_SECONDS}s.
  --seconds N       Override the length. A length that is not a whole number of
                    tiles is not a seamless loop.
  --fps N           Integer frame rate (default 8). The Roku channel plays these
                    frames at this rate.
  --width N         Capture width (default 1920, or 3840 with --4k)
  --height N        Capture height (default 1080, or 2160 with --4k)
  --4k              Capture 3840x2160 and encode the master video as HEVC
  --scale N         Cloud resolution as a fraction of the frame (default 0.6)
  --t0 N            Flight time at the first frame, seconds (default 84)
  --crf N           x264/x265 quality (default 16)
  --preset NAME     x264 preset (default medium)
  --jpeg-quality N  Master JPEG quality 0-1 (default 0.9)
  --roku-width N    Width of the frames the screensaver streams (default 1280)
  --roku-height N   Height of those frames (default 720)
  --roku-q N        ffmpeg JPEG quality for those frames, 2 is high (default 3)
  --out DIR         Output directory (default roku/dist)
  --keep-master     Keep the full-resolution JPEG masters
  --no-video        Skip the MP4
  --probe           Render two stills one tile apart and print how well they match
`);
  process.exit(0);
}

const probe = argv.includes('--probe');
const fourK = argv.includes('--4k') || argv.includes('--4K');
const outDir = path.resolve(REPO, String(opt('--out', 'roku/dist')));
const fps = Number(opt('--fps', 8));
const tiles = Number(opt('--tiles', 1));
const secondsOpt = opt('--seconds', null);
const duration = secondsOpt != null && secondsOpt !== true ? Number(secondsOpt) : tiles * TILE_SECONDS;
const width = Number(opt('--width', fourK ? 3840 : 1920));
const height = Number(opt('--height', fourK ? 2160 : 1080));
const scale = Number(opt('--scale', 0.6));
const t0 = Number(opt('--t0', 84));
const crf = Number(opt('--crf', 16));
const preset = String(opt('--preset', 'medium'));
const jpegQuality = Number(opt('--jpeg-quality', 0.9));
const rokuW = Number(opt('--roku-width', 1280));
const rokuH = Number(opt('--roku-height', 720));
const rokuQ = Number(opt('--roku-q', 3));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim();
    throw new Error(`${cmd} exited ${r.status}${detail ? `\n${detail}` : ''}`);
  }
  return r;
}

function psnr(a, b, blur) {
  const filter = blur
    ? '[0:v]scale=160:90:flags=area,format=gray[a];[1:v]scale=160:90:flags=area,format=gray[b];[a][b]psnr'
    : 'psnr';
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', filter, '-f', 'null', '-'], { encoding: 'utf8' });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = text.match(/average:([0-9.]+|inf)/);
  if (!m) return null;
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

function eventsFor(seconds) {
  const whole = Math.round(seconds / TILE_SECONDS);
  if (Math.abs(seconds - whole * TILE_SECONDS) > 1e-3 || whole < 1) return [];
  const span = whole * TILE_SECONDS;
  const specs = [
    [22, 'window.__cloudScene.farFlash()'],
    [48, "__pick('deep', r => r && r.visible >= 0.25)"],
    [78, 'window.__cloudScene.meteor()'],
    [112, 'window.__cloudScene.farFlash()'],
    [148, "__pick('cg', r => r && r.visible >= 0.2)"],
    [182, 'window.__cloudScene.meteor()'],
    [214, "__pick('deep', r => !!r)"],
    [236, 'window.__cloudScene.farFlash()']
  ];
  const events = [];
  for (let i = 0; i < whole; i++) {
    for (const [at, js] of specs) {
      const t = i * TILE_SECONDS + at;
      if (t >= 8 && t <= span - 8) events.push({ at: t, js });
    }
  }
  // A scripted aircraft stays visible for up to about 650s. Only a longer loop
  // can include one and still be empty at the join.
  if (span > 670) events.push({ at: 24, js: 'window.__cloudScene.aircraft()' });
  events.sort((a, b) => a.at - b.at);
  return events;
}

function storage() {
  return {
    'moonlit-cloud-sea:sky:v1': { twinkle: 1.4, low: 0.035, lamps: 1.95, meteors: 0 },
    'moonlit-cloud-sea:sound:v1': { on: false, volume: 0, wind: 0, whistle: 0, thunder: 0, delay: 1 }
  };
}

if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
  console.error('fps must be an integer from 1 to 60 so the loop lands on the cloud-jitter cycle');
  process.exit(1);
}
if (!(duration > 0)) {
  console.error('duration must be positive');
  process.exit(1);
}

if (probe) {
  const dir = path.join(outDir, 'probe');
  fs.mkdirSync(dir, { recursive: true });
  const times = [t0, t0 + TILE_SECONDS];
  const cfg = {
    mode: 'stills',
    times,
    w: 960,
    h: 540,
    scale: 0.5,
    fps: 8,
    warmup: 4,
    resetClock: true,
    image: 'png',
    seed: 12345,
    t0,
    loopRates: loopRates(),
    storage: storage()
  };
  const cfgPath = path.join(dir, 'probe.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('probe: rendering a still at', times.join('s and '), 's');
  run(process.execPath, [path.join(REPO, 'tools/record.mjs'), cfgPath], { stdio: 'inherit' });
  const a = path.join(dir, `still_${String(times[0]).padStart(4, '0')}.png`);
  const b = path.join(dir, `still_${String(times[1]).padStart(4, '0')}.png`);
  const full = psnr(a, b, false);
  const soft = psnr(a, b, true);
  console.log(`probe PSNR full=${full} blurred=${soft}`);
  fs.writeFileSync(path.join(dir, 'probe-report.json'), JSON.stringify({ times, full, blurred: soft }, null, 2));
  if (!(soft >= 30) && soft !== Infinity) {
    console.error('probe: the tile does not close tightly enough (blurred PSNR < 30)');
    process.exit(1);
  }
  console.log('probe: loop point matches');
  process.exit(0);
}

const seamless = Math.abs(duration / TILE_SECONDS - Math.round(duration / TILE_SECONDS)) < 1e-6;
const count = Math.round(duration * fps);
const master = path.join(outDir, 'master');
fs.mkdirSync(outDir, { recursive: true });
const cfg = {
  mode: 'video',
  w: width,
  h: height,
  scale,
  fps,
  sub: 1,
  t0,
  warmup: 4,
  seconds: duration,
  tail: 1,
  image: 'jpeg',
  jpegQuality,
  frames: 'master',
  seed: 12345,
  loopRates: loopRates(),
  storage: storage(),
  events: eventsFor(duration)
};
const cfgPath = path.join(outDir, 'capture.json');
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`capturing ${count} frames, ${duration}s at ${width}x${height}, ${fps} fps, scale ${scale}`);
console.log(seamless
  ? `seamless loop: ${Math.round(duration / TILE_SECONDS)} tile(s) of ${TILE_SECONDS}s`
  : 'this length is not a whole number of tiles, so the join will not be seamless');

run(process.execPath, [path.join(REPO, 'tools/record.mjs'), cfgPath], { stdio: 'inherit' });

const first = path.join(master, 'frame_00000.jpg');
const tail = path.join(master, 'tail.jpg');
if (!fs.existsSync(first)) {
  console.error('capture produced no frames');
  process.exit(1);
}
let loop = null;
if (fs.existsSync(tail)) {
  loop = { full: psnr(first, tail, false), blurred: psnr(first, tail, true) };
  console.log(`loop check PSNR full=${loop.full} blurred=${loop.blurred}`);
}

const mp4 = path.join(outDir, fourK || height > 1080 ? 'nightscape-4k.mp4' : 'nightscape-1080p.mp4');
if (!argv.includes('--no-video')) {
  const high = width > 1920 || height > 1080;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(fps), '-start_number', '0',
    '-i', path.join(master, 'frame_%05d.jpg'),
    '-frames:v', String(count),
    '-an', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps)
  ];
  if (high) {
    args.push('-c:v', 'libx265', '-tag:v', 'hvc1', '-preset', 'medium', '-crf', String(crf), '-x265-params', 'aq-mode=3');
  } else {
    args.push(
      '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-tune', 'grain',
      '-profile:v', 'high', '-level', '4.1', '-g', String(Math.max(fps * 2, 1)),
      '-x264-params', 'aq-mode=3'
    );
  }
  args.push(mp4);
  console.log('encoding', path.basename(mp4));
  run('ffmpeg', args, { stdio: 'inherit' });
}

const frames = path.join(outDir, 'frames');
fs.mkdirSync(frames, { recursive: true });
console.log(`writing ${rokuW}x${rokuH} screensaver frames`);
run('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-start_number', '0', '-i', path.join(master, 'frame_%05d.jpg'),
  '-frames:v', String(count),
  '-vf', `scale=${rokuW}:${rokuH}`,
  '-q:v', String(rokuQ),
  '-start_number', '0',
  path.join(frames, 'frame_%05d.jpg')
], { stdio: 'inherit' });
const firstRoku = path.join(frames, 'frame_00000.jpg');
const lastRoku = path.join(frames, `frame_${String(count - 1).padStart(5, '0')}.jpg`);
if (!fs.existsSync(firstRoku) || !fs.existsSync(lastRoku)) {
  throw new Error(`screensaver frames must be numbered 0 through ${count - 1}`);
}

const playlist = {
  name: 'Nightscape',
  fps,
  count,
  width: rokuW,
  height: rokuH,
  pattern: 'frame_%05d.jpg',
  loopSeconds: duration,
  tiles: duration / TILE_SECONDS,
  seamless
};
fs.writeFileSync(path.join(frames, 'playlist.json'), JSON.stringify(playlist, null, 2));

const sample = fs.statSync(path.join(frames, 'frame_00000.jpg')).size;
const mp4Size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
const report = {
  width, height, fps, scale, seconds: duration, frames: count, seamless,
  tiles: duration / TILE_SECONDS,
  loopPsnr: loop,
  mp4: fs.existsSync(mp4) ? path.relative(REPO, mp4) : null,
  mp4Bytes: mp4Size,
  framesDir: path.relative(REPO, frames),
  rokuFrameBytes: sample,
  rokuMegabitsPerSecond: +((sample * fps * 8) / 1e6).toFixed(2)
};
fs.writeFileSync(path.join(outDir, 'capture-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!argv.includes('--keep-master')) {
  fs.rmSync(master, { recursive: true, force: true });
}
fs.rmSync(path.join(outDir, 'profile'), { recursive: true, force: true });
console.log('host the frames/ folder over HTTP or HTTPS, then set that URL with');
console.log('  FRAMES_URL=https://your.host/nightscape/ node roku/build.mjs');
console.log('or type it into the screensaver settings screen on the Roku.');
