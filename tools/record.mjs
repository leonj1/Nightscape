// Offline recorder for the Moonlit Cloud Sea: drives headless Chrome frame by frame over
// the DevTools protocol and either saves stills or pipes frames into ffmpeg.
// usage: node tools/record.mjs path/to/config.json   (see tools/example-video.json)
// needs Node 22 or later, Google Chrome and ffmpeg; set CHROME to use another Chrome binary
// optional: image "jpeg" (jpegQuality 0-1), loopRates {y1,y2,pitch,b1,b2}, warmup seconds,
//           tail extra frames written beside a frames folder, resetClock on each still
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = cfg.w || 1920, H = cfg.h || 1080;
const PORT = Number(process.env.RECORD_PORT) || 8777;
const DPORT = Number(process.env.RECORD_DPORT) || 9333;
const OUT = path.dirname(path.resolve(process.argv[2]));
const JPEG = cfg.image === 'jpeg';
const EXT = JPEG ? 'jpg' : 'png';

// --- static server for the project folder
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, u === '/' ? '/index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

// --- headless Chrome
const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
}[process.platform] || 'google-chrome';
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DPORT}`, `--user-data-dir=${OUT}/profile`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-dev-shm-usage',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${DPORT}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {}
  await sleep(250);
}
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (function(){
    let a = ${cfg.seed || 12345} >>> 0;
    Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    window.matchMedia = function(){ return { matches: false, media: '', addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false; } }; };
    try {
      const hide = document.createElement('style');
      hide.textContent = '#grade,#hint,#status,#msg{display:none !important}';
      document.documentElement.appendChild(hide);
    } catch (e) {}
  })();
  window.__cloudDebug = { frames: 3, scale: ${cfg.scale || 1}, t: ${cfg.t0 || 30}, loopRates: ${cfg.loopRates ? JSON.stringify(cfg.loopRates) : 'null'} };
  try { localStorage.clear(); const s = ${JSON.stringify(cfg.storage || {})}; for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); } catch (e) {}
` });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
for (let i = 0; ; i++) {
  await sleep(500);
  try { if (await evalJS('!!window.__done')) break; } catch (e) {}
  if (i > 240) throw new Error('scene never finished baking');
}
const info = await evalJS(`(() => { const c = document.querySelector('canvas'); const gl = c.getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { w: c.width, h: c.height, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?' }; })()`);
console.log('scene ready', JSON.stringify(info));

// draw a frame and read the canvas back in the same task, before the browser presents
// (and clears) the drawing buffer
// the flight position is tracked here so the camera can move at cfg.speed times its normal
// pace while everything else (twinkle, lights, lightning, accumulation) runs in real time
const SPEED = cfg.speed || 1;
let sim = 0;
const step = (dt) => { sim += dt * SPEED; return `window.__cloudScene.setTime(${sim - dt}), window.__cloudScene.advance(${dt})`; };
const encoded = JPEG
  ? `document.querySelector('canvas').toDataURL('image/jpeg',${Number(cfg.jpegQuality) || 0.92})`
  : `document.querySelector('canvas').toDataURL('image/png')`;
const frameAndGrab = async (dt) => {
  const url = await evalJS(`(${step(dt)}, ${encoded})`);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};
const FPS = cfg.fps || 60, DT = 1 / FPS;
const advance = (dt) => evalJS(`(${step(dt)}, 0)`);

if (cfg.mode === 'stills') {
  // one still per start time, after a short warm-up so the accumulation settles
  const warm = cfg.warmup != null ? cfg.warmup : 1;
  for (const t of cfg.times) {
    if (cfg.resetClock) await evalJS('window.__cloudScene.setClock(0); window.__cloudScene.setFrame(0)');
    sim = t - warm * SPEED;
    const steps = Math.max(0, Math.round(warm * FPS) - 1);
    for (let k = 0; k < steps; k++) await advance(DT);
    fs.writeFileSync(`${OUT}/still_${String(t).padStart(4, '0')}.${EXT}`, await frameAndGrab(DT));
    console.log('still', t);
  }
} else {
  // video: simulate at FPS * sub, keep every sub-th frame, run the events at their times.
  // __pick(kind, ok) re-rolls a flash until ok(result) holds (or gives up after 20 tries).
  await evalJS(`window.__pick = (kind, ok) => { let r; for (let i = 0; i < 20; i++) { r = window.__cloudScene.strike(kind); if (r && ok(r)) break; } return r; }`);
  const SUB = cfg.sub || 1, SDT = DT / SUB;
  const warmSim = cfg.warmup != null ? cfg.warmup : 2 * SPEED;
  sim = (cfg.t0 || 30) - warmSim;
  const warmSteps = Math.max(0, Math.round(warmSim / (SDT * SPEED)));
  for (let k = 0; k < warmSteps; k++) await advance(SDT);
  const N = Math.round(cfg.seconds * FPS);
  // extra frames past the loop, so a capture can compare the next frame with frame 0
  const TAIL = cfg.tail || 0;
  // with cfg.frames set, numbered frames go into that folder instead of a video
  const FR = cfg.frames ? path.resolve(OUT, cfg.frames) : null;
  if (FR) fs.mkdirSync(FR, { recursive: true });
  const ff = FR ? null : spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS),
    ...(JPEG ? ['-c:v', 'mjpeg'] : ['-c:v', 'png']), '-i', '-',
    '-c:v', 'libx264', '-preset', cfg.preset || 'slow', '-crf', String(cfg.crf || 16), '-tune', 'grain', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-movflags', '+faststart', '-an', '-r', String(FPS), path.resolve(OUT, cfg.out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const events = (cfg.events || []).slice().sort((a, b) => a.at - b.at);
  const t0 = Date.now();
  for (let k = 0; k < N + (FR ? TAIL : 0); k++) {
    for (let j = 0; j < SUB; j++) {
      const tv = (k * SUB + j) / (FPS * SUB);
      while (events.length && events[0].at <= tv) { const e = events.shift(); console.log('event at', tv.toFixed(2), e.js, '->', JSON.stringify(await evalJS(e.js))); }
      if (j < SUB - 1) await advance(SDT);
    }
    const png = await frameAndGrab(SDT);
    if (FR && k >= N) {
      const name = TAIL === 1 ? `tail.${EXT}` : `tail_${String(k - N).padStart(2, '0')}.${EXT}`;
      fs.writeFileSync(path.join(FR, name), png);
    } else if (FR) fs.writeFileSync(`${FR}/frame_${String(k).padStart(5, '0')}.${EXT}`, png);
    else if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if (cfg.snap && cfg.snap.includes(k)) fs.writeFileSync(`${OUT}/frame_${k}.${EXT}`, png);
    if (k % FPS === 0) console.log(`frame ${k}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
  console.log('wrote', FR || path.resolve(OUT, cfg.out));
}
ws.close(); chrome.kill(); server.close();
process.exit(0);
