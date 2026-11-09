# Nightscape on a Roku screensaver

Nightscape is a WebGL scene. A Roku has no browser and no WebGL, and a screensaver is not allowed to play video (`Video` and `roVideoPlayer` are rejected by the firmware). What does work on a stock Roku is drawing images. This folder captures a seamlessly looping flight and plays it back as fullscreen JPEG frames.

The world is one 320-unit tile and the camera cruises at 1.25 units per second, so the clouds and the ground repeat every **256 seconds** (4 minutes 16 seconds). During a capture the camera's altitude, pitch and bank are retimed to that same period (the live page is unchanged unless the recorder asks). An integer number of tiles is therefore a hard cut that continues the flight, with no crossfade. Star twinkle and film grain are not periodic; at the join they change by about one sparkle, which is the same kind of change they make every frame.

| Length | Flag | What you get |
| --- | --- | --- |
| 4 min 16 s | `--tiles 1` (default) | One tile. Lightning, distant storms and meteors are scripted, and none of them sit on the join. |
| 12 min 48 s | `--tiles 3` | Three tiles, different flashes in each, plus one aircraft. A flight can stay up for about 11 minutes, so it is only added when the loop is longer than that and it has faded before the join. |
| 17 min 4 s | `--tiles 4` | Four tiles. Same aircraft rule: it fits, and it is gone before the join. |

The channel zip does not contain the frames. A sideload package should stay under a few megabytes (the installer warns above 500 KB and some devices refuse a zip past about 2–4 MB). A 1080p H.264 of even one tile is far larger than that. Host the `frames/` folder, then either bake the URL into the zip or type it on the TV.

## What a capture produces

`node roku/capture.mjs` writes into `roku/dist/` (gitignored):

| File | Role |
| --- | --- |
| `nightscape-1080p.mp4` | H.264 High profile, level 4.1, yuv420p, no audio, fast start. For preview on a computer. `--4k` writes `nightscape-4k.mp4` as HEVC instead. |
| `frames/playlist.json` | Frame rate, count, size. The screensaver fetches this first. |
| `frames/frame_00000.jpg` … | The frames it displays, 1280×720 by default so a TV on Wi-Fi can keep up. |
| `capture-report.json` | Length, byte size, and a PSNR check of the loop point. |

Frames are read from the WebGL canvas, so the settings button and the hint line are not in the picture. The capture is silent.

## Regenerate the video

Needs Node 22 or newer, Google Chrome and ffmpeg. Set `CHROME` if the binary is not `google-chrome`. A discrete GPU helps. Without one, Chrome falls back to a software renderer and a 1080p frame at the default cloud scale takes about 3 seconds, so one tile is roughly two hours and three tiles is most of a day. The recorder steps the scene itself, so a slow frame never becomes a stutter, and the same seed always makes the same film.

```bash
node roku/capture.mjs --probe          # two stills, one tile apart; checks the join
node roku/capture.mjs                  # 256 seconds, 1920×1080, 8 fps
node roku/capture.mjs --tiles 3        # 768 seconds
node roku/capture.mjs --fps 12 --scale 0.8
node roku/capture.mjs --4k --fps 24    # 3840×2160 master, HEVC file; frames stay 720p
node roku/capture.mjs --roku-width 1920 --roku-height 1080
```

`--fps` has to be a whole number. The cloud pass jitters on a 64-frame cycle, and a whole number of tiles at an integer frame rate lands back on the same phase.

Useful knobs: `--scale` (cloud resolution, default 0.6), `--crf` (default 16), `--preset`, `--jpeg-quality`, `--t0` (where the loop starts in the flight, default 84, which is the moonlit opening the project already uses). `--seconds 30` records a clip that does **not** loop cleanly, for a quick test of the pipeline.

## Build the channel

Artwork is cropped from `channel/images/source.jpg`, a real Nightscape frame. Icons are 540×405 (PNG, because that height is odd and JPEG cannot store it), 290×218 and 214×144. Splashes are 1920×1080, 1280×720 and 720×480. The screensaver falls back to `fallback.jpg` (1280×720) on the night colour `#04070F`.

```bash
node roku/build.mjs
FRAMES_URL=https://example.com/nightscape/ node roku/build.mjs
```

The zip is `roku/dist/nightscape-screensaver.zip`. `FRAMES_URL` is the folder that contains `playlist.json` and the JPEGs, with or without a trailing slash. Leave it unset to type the URL on the TV later. The build checks the manifest, the `RunScreenSaver` entry, the image sizes, and that the zip has no video node and no extra parent folder.

## Host the frames

Upload the contents of `roku/dist/frames/` so these URLs return the files themselves (a 200, not a login page and not a redirect the player will drop):

- `https://example.com/nightscape/playlist.json`
- `https://example.com/nightscape/frame_00000.jpg`

GitHub release assets redirect to a short-lived address, and Roku's image loader often will not follow that. A static bucket, a small VPS, or any host that serves the folder directly is the right place. `Content-Type: image/jpeg` and `application/json` are the right types.

On the same network as the TV you can also serve the folder from the machine that captured it:

```bash
cd roku/dist/frames
python3 -m http.server 8080 --bind 0.0.0.0
```

The URL is `http://<that-machine-ip>:8080/`. If the Roku refuses plain HTTP, use an HTTPS host instead. At the default 8 fps a frame is typically under 150 KB, so the TV needs a few megabits of steady Wi-Fi. `--fps 12` or full-HD frames need more. If the network falls behind, the screensaver holds the current frame until the next one has loaded, then carries on. After several failures in a row it drops back to the still.

## Install it on the Roku

The channel is sideloaded. It is not published to the Channel Store, and only one developer channel can be installed at a time.

1. On the Roku remote, press **Home** three times, **Up** twice, **Right**, **Left**, **Right**, **Left**, **Right**.
2. The developer screen appears. Turn the installer on and choose a password. Note it down.
3. In **Settings > Network > About**, note the IP address.
4. On a computer on the same network, open `http://<roku-ip>` in a browser. Sign in with the username `rokudev` and the password from step 2.
5. Upload `roku/dist/nightscape-screensaver.zip`. Wait until the installer says the channel is installed.
6. On the TV, open **Settings > Theme > Screensavers** and choose **Nightscape**.

The screensaver starts after the idle time you set in that same menu. Any key on the remote dismisses it. There is no sound.

To point it at a folder without rebuilding:

1. Open **Settings > Theme > Screensavers**, highlight Nightscape, and choose **Change screensaver settings** (some devices call this **Custom settings**).
2. Enter the folder URL, move down to **Save**, and press OK. **Clear saved URL** goes back to the URL that was baked in at build time, if there was one.
3. Press Back to leave the screen.

Until a URL loads, the screen shows the bundled night still and a short line of text, on the dark background `#04070F`.

## Channel layout

```
roku/channel/
  manifest
  source/main.brs          RunScreenSaver and RunScreenSaverSettings
  source/config.brs        the optional built-in frames URL
  components/              fullscreen frame playback, and the settings screen
  images/                  posters, splashes, fallback, and source.jpg
roku/capture.mjs           record the loop
roku/build.mjs             zip the channel and check it
roku/loop-period.mjs       the 256-second tile math
```

`RunScreenSaver` reads the registry, then the built-in URL, fetches `playlist.json`, and swaps two posters so the next frame is loading while the current one is on screen. `RunScreenSaverSettings` is how the URL gets into the registry. There is no `Main()`, so the channel shows up as a screensaver rather than as a tile on the home screen.
