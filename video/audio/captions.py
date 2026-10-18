"""Word-timed captions for a voiceover script, from faster-whisper word timestamps.

Usage (from video/):
  audio/.venv/bin/python audio/captions.py <lines.json> <vo dir> <captions.json>

Whisper only supplies timing. The words shown are the script's `text`, which can differ from
what is spoken (`say`, e.g. "5%" vs "five percent"), so each display word is timed by its
position in the line: letter offsets are mapped onto the recognised words' time spans.
"""

import difflib
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


def spans(weights: list[float]) -> list[tuple[float, float]]:
    total = sum(weights) or 1
    out, acc = [], 0.0
    for n in weights:
        out.append((acc / total, (acc + n) / total))
        acc += n
    return out


def spoken_weights(display: list[str], spoken: str) -> list[float]:
    """Letters actually spoken for each display word ("5%" -> "five percent" counts 11)."""
    d = [letters(w) for w in display]
    s = [letters(w) for w in spoken.split()]
    out = [0.0] * len(d)
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=d, b=s, autojunk=False).get_opcodes():
        said = sum(len(x) for x in s[j1:j2])
        if tag == "equal":
            for k in range(i2 - i1):
                out[i1 + k] = len(s[j1 + k])
        elif tag == "insert":
            out[max(i1 - 1, 0)] += said
        else:
            for k in range(i1, i2):
                out[k] = said / (i2 - i1) if said else 0.5
    return out


def resample16k(x: np.ndarray, sr: int) -> np.ndarray:
    if x.ndim > 1:
        x = x.mean(axis=1)
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def main() -> None:
    lines_path, vo_dir, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    script = json.loads(lines_path.read_text())
    model = WhisperModel("base.en", device="cpu", compute_type="float32")
    result = []
    for line in script["lines"]:
        audio, sr = sf.read(vo_dir / f"{line['id']}.wav", dtype="float32")
        # Temperature 0 only: the sampling fallback makes the transcript, and so the timings, random.
        # Prompting with the script fixes spelling but can append repeated words, so the heard
        # words are cut off once they cover the script's letters.
        spoken = line.get("say", line["text"])
        segments, _ = model.transcribe(
            resample16k(audio, sr),
            word_timestamps=True,
            beam_size=5,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=spoken,
        )
        heard, covered = [], 0
        for w in (w for s in segments for w in (s.words or []) if letters(w.word)):
            if covered >= len(letters(spoken)) - 1:
                break
            heard.append(w)
            covered += len(letters(w.word))
        heard_spans = spans([len(letters(w.word)) for w in heard])
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
        for w, (a, b) in zip(display, spans(spoken_weights(display, spoken))):
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
