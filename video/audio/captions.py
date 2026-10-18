"""Word-timed captions for a voiceover script, from faster-whisper word timestamps.

Usage (from video/):
  audio/.venv/bin/python audio/captions.py <lines.json> <vo dir> <captions.json>

Whisper only supplies timing. The words shown are the script's `text`, which can differ from
what is spoken (`say`, e.g. "5%" vs "five percent"), so each display word is timed by its
position in the line: letter offsets are mapped onto the recognised words' time spans.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

FPS = 30


def letters(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def spans(words: list[str]) -> list[tuple[float, float]]:
    total = sum(len(letters(w)) for w in words) or 1
    out, acc = [], 0
    for w in words:
        n = len(letters(w))
        out.append((acc / total, (acc + n) / total))
        acc += n
    return out


def resample16k(x: np.ndarray, sr: int) -> np.ndarray:
    if x.ndim > 1:
        x = x.mean(axis=1)
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def main() -> None:
    lines_path, vo_dir, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    script = json.loads(lines_path.read_text())
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    result = []
    for line in script["lines"]:
        audio, sr = sf.read(vo_dir / f"{line['id']}.wav", dtype="float32")
        segments, _ = model.transcribe(resample16k(audio, sr), word_timestamps=True, beam_size=5)
        heard = [w for s in segments for w in (s.words or []) if letters(w.word)]
        heard_spans = spans([w.word for w in heard])
        clip_end = len(audio) / sr

        def at(frac: float) -> float:
            for (a, b), w in zip(heard_spans, heard):
                if frac <= b:
                    if frac < a:
                        return w.start
                    return w.start + (frac - a) / max(b - a, 1e-6) * (w.end - w.start)
            return heard[-1].end if heard else clip_end * frac

        display = line["text"].split()
        words = []
        for w, (a, b) in zip(display, spans(display)):
            t0, t1 = at(a + 1e-6), at(b)
            words.append(
                {
                    "w": w,
                    "from": round(line["at"] + t0 * FPS, 1),
                    "to": round(line["at"] + max(t1, t0 + 0.08) * FPS, 1),
                }
            )
        transcript = " ".join(w.word.strip() for w in heard)
        print(f"{line['id']}: heard \"{transcript}\"")
        result.append({"id": line["id"], "words": words})
    out_path.write_text(json.dumps({"lines": result}, indent=1) + "\n")


if __name__ == "__main__":
    main()
