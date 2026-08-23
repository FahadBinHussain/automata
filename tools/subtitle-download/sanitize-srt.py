import re
import sys
from pathlib import Path

def sanitize_srt(src: Path, dst: Path) -> int:
    raw = src.read_text(encoding="utf-8-sig", errors="replace")
    lines = raw.splitlines()

    out: list[str] = []
    idx = 0
    timing_re = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")

    while idx < len(lines):
        line = lines[idx].strip()
        idx += 1
        if not line:
            continue
        if not timing_re.match(line):
            continue
        # we have a timing line; collect text until next blank/timing/number
        text = []
        while idx < len(lines):
            nxt = lines[idx].strip()
            if not nxt:
                idx += 1
                break
            if timing_re.match(nxt):
                break
            if re.fullmatch(r"\d+", nxt):
                break
            text.append(lines[idx].strip())
            idx += 1
        # strip HTML tags from each text line
        clean = []
        for t in text:
            t = re.sub(r"<[^>]+>", "", t)
            t = re.sub(r"&nbsp;?", " ", t)
            t = t.replace("\\h", " ").strip()
            if t:
                clean.append(t)
        if not clean:
            continue
        out.append(str(len(out) // 4 + 1))
        out.append(line)
        out.append("\n".join(clean))
        out.append("")

    text = "\n".join(out).rstrip() + "\n"
    dst.write_text(text, encoding="utf-8")
    return len(out)

if __name__ == "__main__":
    total = 0
    for p in sys.argv[1:]:
        src = Path(p)
        if not src.exists():
            continue
        dst = src.with_suffix(".cleaned.srt")
        n = sanitize_srt(src, dst)
        total += 1
        print(f"cleaned {src.name}: {n} lines -> {dst.name}")
    print(f"done {total} files")
