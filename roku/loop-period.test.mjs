import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSignature, loopRates, pathX, TILE_SECONDS } from './loop-period.mjs';

test('snapped camera motion closes after one world tile', () => {
  const rates = loopRates();
  for (const t of [0, 0.125, 12.5, 84, 200.5, 255.875]) {
    const a = cameraSignature(t, rates);
    const b = cameraSignature(t + TILE_SECONDS, rates);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `term ${i} at t=${t}: ${a[i]} vs ${b[i]}`);
    }
  }
});

test('snapped camera motion closes after three tiles', () => {
  const a = cameraSignature(40);
  const b = cameraSignature(40 + 3 * TILE_SECONDS);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6);
});

test('the flight path itself repeats every tile', () => {
  for (const z of [0, 10.5, 123.25, 319]) {
    assert.ok(Math.abs(pathX(z) - pathX(z + 320)) < 1e-5);
  }
});

test('the live bob frequency does not close on a tile', () => {
  const y = (t) => 0.3 * Math.sin(t * 0.071);
  assert.ok(Math.abs(y(84) - y(84 + TILE_SECONDS)) > 0.05);
});

test('an integer frame rate keeps the cloud jitter phase aligned', () => {
  // The cloud march jitters with mod(frame, 64). A whole number of tiles at an
  // integer fps is always a multiple of 64 frames, so the loop point matches.
  for (const fps of [6, 8, 10, 12, 24, 30]) {
    const n = Math.round(TILE_SECONDS * fps);
    assert.equal(n / fps, TILE_SECONDS);
    assert.equal(n % 64, 0);
  }
});
