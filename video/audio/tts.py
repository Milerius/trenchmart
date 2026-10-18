"""Render voiceover lines with Kokoro-82M (Apache-2.0) via kokoro-onnx.

Usage (from video/):
  audio/.venv/bin/python audio/tts.py                        # the promo (audio/vo-lines.json)
  audio/.venv/bin/python audio/tts.py <lines.json> <out dir>  # any other script
Model files are expected in audio/.models/ (see AUDIO_CREDITS.md for download links).
Each line speaks `say` when present (spelled out for the voice), else `text`. Lines are trimmed
of leading/trailing silence; one longer than its slot (maxSec) is re-rendered slightly faster,
up to 1.3x.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent
MODELS = HERE / ".models"


def trim(x: np.ndarray, sr: int, thresh: float = 0.01, pad: float = 0.03) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    if idx.size == 0:
        return x
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(x), idx[-1] + int(pad * sr))
    return x[a:b]


def main() -> None:
    lines_path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "vo-lines.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "build" / "vo"
    script = json.loads(lines_path.read_text())
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    out.mkdir(parents=True, exist_ok=True)
    report = []
    for line in script["lines"]:
        speed = script["speed"]
        text = line.get("say", line["text"])
        while True:
            samples, sr = kokoro.create(text, voice=script["voice"], speed=speed, lang="en-us")
            samples = trim(np.asarray(samples, dtype=np.float32), sr)
            dur = len(samples) / sr
            if dur <= line["maxSec"] or speed >= 1.3:
                break
            speed = round(speed + 0.05, 2)
        sf.write(out / f"{line['id']}.wav", samples, sr, subtype="FLOAT")
        report.append({"id": line["id"], "seconds": round(dur, 2), "speed": speed})
        print(f"{line['id']}: {dur:.2f}s at {speed}x (slot {line['maxSec']}s)")
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
