# TrenchMart promo video

A 29-second promo for X built with [Remotion](https://www.remotion.dev/), at 1080x1080 and
1920x1080, 30 fps. Every format comes in two mixes: one with a voiceover and one with music and SFX
only. The kinetic type carries the story, so the promo also works muted.

| File                                           | Mix                     |
| ---------------------------------------------- | ----------------------- |
| `out/trenchmart-promo-1080x1080.mp4`           | Music + SFX + voiceover |
| `out/trenchmart-promo-1080x1080-music-sfx.mp4` | Music + SFX             |
| `out/trenchmart-promo-1920x1080.mp4`           | Music + SFX + voiceover |
| `out/trenchmart-promo-1920x1080-music-sfx.mp4` | Music + SFX             |

## Render

```bash
npm install
npm run studio   # preview in the browser
npm run render   # all four MP4s into out/
npm run stills   # review stills into out/stills/ (args: [compositionId] [frame...])
```

All timing lives in `src/timeline.ts` (100 BPM, one scene every two bars). The scenes, the music and
the SFX all read it, so changing a beat there moves the picture and the sound together.

## Audio

The mastered mixes in `public/audio/` are committed, so rendering needs nothing else. To rebuild
them:

```bash
npm run audio    # music + SFX (+ voiceover if present) -> public/audio/*.flac at -14 LUFS
```

To regenerate the voiceover after editing `audio/vo-lines.json`, set up Kokoro once and then run
`npm run tts` before `npm run audio`:

```bash
sudo apt-get install -y espeak-ng python3-venv
python3 -m venv audio/.venv
audio/.venv/bin/pip install kokoro-onnx soundfile
mkdir -p audio/.models
curl -L -o audio/.models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o audio/.models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
npm run tts
```

Licences for every sound are listed in [AUDIO_CREDITS.md](./AUDIO_CREDITS.md).
