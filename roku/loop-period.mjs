// The world tile is 320 units and the cruise is 1.25 units/second, so the clouds
// and the ground repeat every 256 seconds. The live camera's altitude, pitch and
// bank use frequencies that do not divide that period. Snapping them to a whole
// number of cycles per tile makes an integer number of tiles a seamless loop.
// These are the same constants as updateCamera() in index.html.

export const TILE = 320;
export const SPEED = 1.25;
export const TILE_SECONDS = TILE / SPEED;

const LIVE = { y1: 0.071, y2: 0.19, pitch: 0.043, b1: 0.012, b2: 0.031 };

function snapTime(omega) {
  const cycles = Math.round((omega * TILE_SECONDS) / (2 * Math.PI)) || 1;
  return (cycles * 2 * Math.PI) / TILE_SECONDS;
}

function snapDistance(omega) {
  const cycles = Math.round((omega * TILE) / (2 * Math.PI)) || 1;
  return (cycles * 2 * Math.PI) / TILE;
}

export function loopRates() {
  return {
    y1: snapTime(LIVE.y1),
    y2: snapTime(LIVE.y2),
    pitch: snapTime(LIVE.pitch),
    b1: snapDistance(LIVE.b1),
    b2: snapDistance(LIVE.b2)
  };
}

export function pathX(z) {
  return 4.5 * Math.sin(z * 0.019634954) + 1.6 * Math.sin(z * 0.039269908 + 1.3);
}

// The parts of the camera that have to agree at t and t + 256s.
export function cameraSignature(t, rates = loopRates()) {
  const z = -t * SPEED;
  const x = pathX(z);
  const y = 3.6 + 0.3 * Math.sin(t * rates.y1) + 0.09 * Math.sin(t * rates.y2 + 1.0);
  const pitch = Math.sin(t * rates.pitch);
  const zz = z - 6;
  const curv = -5.0 * 0.012 * 0.012 * Math.sin(zz * rates.b1) - 2.2 * 0.031 * 0.031 * Math.sin(zz * rates.b2 + 1.3);
  return [x, y, pitch, curv];
}
