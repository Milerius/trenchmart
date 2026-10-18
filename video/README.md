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

# Launch videos

Four launch videos, one feature each. Each one is 34-36 seconds long and comes in 1920x1080 and
1080x1920, with voiceover, music, SFX and burned-in captions. Every claim in them matches the live
devnet product at [trenchmart.fun](https://trenchmart.fun). Mainnet is not live, so the videos
show "Solana devnet" and never claim a mainnet launch.

| Video    | What it shows                                                                                                                                         | Files                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Security | Upload, then static scan + sandboxed run + AI review streaming live; the stricter verdict wins; the signed report on `/verify`                        | `out/launch/trenchmart-security-{1920x1080,1080x1920}.mp4` |
| Escrow   | Pay in SOL into the escrow program, held for 1 hour, dispute window, permissionless release and fee split, program id and Explorer proof              | `out/launch/trenchmart-escrow-{1920x1080,1080x1920}.mp4`   |
| Tiers    | $TRENCH holder tiers: Scout 100k / Trencher 1M / OG 10M get 25% / 60% / 100% off the 5% fee, lowest balance over 72 hours                             | `out/launch/trenchmart-tiers-{1920x1080,1080x1920}.mp4`    |
| Sellers  | The 7-step listing wizard and terminals, update subscriptions (30 days free, then a monthly price), versioning, the creator studio and public profile | `out/launch/trenchmart-sellers-{1920x1080,1080x1920}.mp4`  |

```bash
npm run render:launch              # all eight MP4s into out/launch/
npm run render:launch -- Escrow    # one video, both formats
npm run stills -- Launch-Tiers-9x16 120 480
```

Each video lives in `src/launch/<id>/`: `timeline.ts` (scene lengths in bars and every beat inside
a scene), the scenes, `vo.json` (the script) and `captions.json` (word timings). Shared pieces
(frame, captions, cards, browser screenshots, wide/tall layout) are in `src/launch/kit/`. The
Explorer and site screenshots in `public/launch/` were captured from the live devnet site and
Solana Explorer.

## Launch audio

The mastered mixes in `public/audio/launch/` are committed. To rebuild them after changing a
timeline or a script:

```bash
npm run tts:launch escrow   # Kokoro VO + word-timed captions.json for one video
npm run audio:launch        # music + SFX + VO for all four -> public/audio/launch/*.flac
```

`audio/launch/<id>.ts` sets each video's key, chord progression and SFX cues. The music, SFX and
captions all read the video's timeline, so moving a beat moves the sound with it. In `vo.json`,
`text` is what the captions show and `say` is what Kokoro speaks, e.g. "SOL" is spoken as "sole".
`npm run tts:launch` also needs faster-whisper in the venv for caption timing:

```bash
audio/.venv/bin/pip install faster-whisper
```
