# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "faster-whisper",
#   "ctranslate2==4.4.0",
#   "setuptools<81",
#   "soundfile",
#   "numpy",
#   "nvidia-cublas-cu12; sys_platform == 'win32'",
#   "nvidia-cudnn-cu12==8.9.7.29; sys_platform == 'win32'",
# ]
# ///
# purpose: offline bangla voice-note transcription (tugstugi whisper-medium ct2, verified 2026-09-14)
# usage:   uv run --script bn-stt.py <audio> [--model ID] [--beam N] [--device cpu|cuda|auto] [--vad]
# notes:   HF_TOKEN recommended (anonymous downloads crawl); PYTHONIOENCODING=utf-8 for console output
import argparse, os, sys, tempfile, time, unicodedata

p = argparse.ArgumentParser()
p.add_argument("audio")
p.add_argument("--model", default="SayedShaun/bengali-whisper-medium-ct2")
p.add_argument("--beam", type=int, default=5)
p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
p.add_argument("--vad", action="store_true", help="silero VAD: skip silence, fix hallucinations")
a = p.parse_args()

if not os.path.exists(a.audio):
    sys.exit(f"no such file: {a.audio}")

# RTX 5050 laptop: python can't find cublas/cudnn by default -> put the nvidia wheels' bin dirs on PATH first
if a.device in ("auto", "cuda"):
    try:
        import glob
        import nvidia
        base = os.path.dirname(nvidia.__path__[0])
        for b in glob.glob(os.path.join(base, "nvidia", "*", "bin")):
            os.environ["PATH"] = b + os.pathsep + os.environ["PATH"]
    except ImportError:
        pass

import ctranslate2
device = a.device
if device == "auto":
    try:
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        device = "cpu"
compute = {"cuda": "int8_float16", "cpu": "int8"}[device]
print(f"[bn-stt] device={device} compute={compute} beam={a.beam} vad={a.vad} model={a.model}", flush=True)

import subprocess
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

wav = os.path.join(tempfile.gettempdir(), "bn-stt-16k.wav")
subprocess.run(["ffmpeg", "-y", "-i", a.audio, "-ac", "1", "-ar", "16000", wav],
               check=True, capture_output=True)
audio, sr = sf.read(wav)
os.remove(wav)
audio = np.asarray(audio, dtype=np.float32)  # onnxruntime VAD wants float32, soundfile gives float64
dur = len(audio) / sr

t0 = time.time()
m = WhisperModel(a.model, device=device, compute_type=compute)
t1 = time.time()
segs, _ = m.transcribe(audio, language="bn", beam_size=a.beam,
                       condition_on_previous_text=False, vad_filter=a.vad)
print(f"[bn-stt] audio={dur:.1f}s load={t1-t0:.1f}s", flush=True)
for s in segs:
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {unicodedata.normalize('NFC', s.text).strip()}", flush=True)
print(f"[bn-stt] transcribe={time.time()-t1:.1f}s (rtf={(time.time()-t1)/dur:.1f}x)", flush=True)
os._exit(0)  # ct2 4.4.0 + cudnn 8 crashes in atexit on windows; output is already flushed
