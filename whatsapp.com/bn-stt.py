# /// script
# requires-python = ">=3.11"
# dependencies = ["faster-whisper", "ctranslate2==4.4.0", "setuptools<81", "soundfile"]
# ///
# purpose: offline bangla voice-note transcription (tugstugi whisper-medium ct2, verified 2026-09-14)
# inputs:  [1] audio file (ogg/mp3/wav — any ffmpeg-readable)  [2] optional model id (default SayedShaun/bengali-whisper-medium-ct2)
# run:     uv run --no-project python bn-stt.py C:\tmp\note.ogg
# env:     HF_TOKEN recommended (anonymous downloads crawl), PYTHONIOENCODING=utf-8 for console output
import os, sys, unicodedata
if len(sys.argv) < 2:
    sys.exit("usage: bn-stt.py <audio-file> [model-id]")
src = sys.argv[1]
model_id = sys.argv[2] if len(sys.argv) > 2 else "SayedShaun/bengali-whisper-medium-ct2"
wav = r"C:\tmp\bn-stt-16k.wav"
import subprocess
subprocess.run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", wav], check=True, capture_output=True)
import soundfile as sf
from faster_whisper import WhisperModel
audio, sr = sf.read(wav)
print(f"audio={len(audio)/sr:.1f}s model={model_id}", flush=True)
m = WhisperModel(model_id, device="cpu", compute_type="int8")
os.remove(wav)
segs, _ = m.transcribe(audio, language="bn", beam_size=5, condition_on_previous_text=False)
for s in segs:
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {unicodedata.normalize('NFC', s.text).strip()}", flush=True)
