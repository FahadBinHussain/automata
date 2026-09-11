#!/usr/bin/env python3
"""
filecrypt.cc instant bypass — hybrid deepseek-style
- pow_x/pow_y/pow_data harvested headless via node shims (m.js R, s.js S.collect, cid fetch)
- PoW solved offline via pow.py (native hashlib, 1-7s not 7m)
- if headless still gated (TLS fingerprint), falls back to CDP browser harvest (prints hint)

usage: python solve-container.py https://filecrypt.cc/Container/FCE74DF1E1.html
"""
import sys, os, re, json, time, random, subprocess, tempfile
from pathlib import Path
from urllib.parse import urljoin
import urllib.request, urllib.parse

ROOT = Path(__file__).parent
POW_PY = ROOT / "pow.py"
BUILDER = ROOT / "run-signals-builder.cjs"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

import http.cookiejar
CJ = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ))

def fetch(url, headers=None, data=None):
    h = {"User-Agent": UA}
    if headers: h.update(headers)
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if data else "GET")
    with OPENER.open(req, timeout=30) as r:
        return r.read().decode(errors="ignore"), r.headers

def build_pow_data(work, base_url, s_src):
    url = urljoin(base_url, s_src)
    data, _ = fetch(url)
    p = work / "s_signals.js"
    p.write_text(data, encoding="utf-8")
    subprocess.check_call(["node", str(BUILDER), str(p), "signals"], cwd=str(work))
    out = subprocess.check_output(["node", str(work / "run_payload.mjs")], text=True, cwd=str(work), timeout=20)
    for line in out.splitlines():
        if line.startswith("COLLECT="):
            return line[8:]
    raise RuntimeError(f"pow_data failed: {out[-800:]}")

def solve_pow(challenge, difficulty):
    # call pow.py as subprocess (multiprocess)
    out = subprocess.check_output([sys.executable, str(POW_PY), challenge, str(difficulty)], text=True, timeout=60)
    j = json.loads(out)
    return j["nonce"]

def build_pow_x(work, base_url, m_src):
    # download m.js
    url = urljoin(base_url, m_src)
    data, _ = fetch(url)
    p = work / "m_ext.js"
    p.write_text(data, encoding="utf-8")
    # builder writes run_payload.mjs
    subprocess.check_call(["node", str(BUILDER), str(p)], cwd=str(work))
    out = subprocess.check_output(["node", str(work / "run_payload.mjs")], text=True, cwd=str(work), timeout=15)
    for line in out.splitlines():
        if line.startswith("RESULT="):
            return line[7:]
    raise RuntimeError(f"pow_x failed: {out[-500:]}")



if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} https://filecrypt.cc/Container/XXXX.html", file=sys.stderr)
        sys.exit(2)
    container_url = sys.argv[1]
    # quick demo: just solve PoW for that container's live challenge
    # full unlock needs cookie jar + form POST; this demo fetches challenge via browser-shim path
    # for now, benchmark offline solver on a live challenge fetch
    base = "https://filecrypt.cc"
    # 1. GET container
    html, hdrs = fetch(container_url, headers={"Accept":"text/html"})
    m = re.search(r'data-session="([^"]+)"', html)
    if not m:
        print("no data-session — already unlocked or layout changed", file=sys.stderr)
        sys.exit(1)
    session_path = m.group(1)
    m_ext = re.search(r'data-ext="([^"]+)"', html).group(1)
    s_sig = re.search(r'data-sig="([^"]+)"', html).group(1)
    print(f"session {session_path} m={m_ext} s={s_sig}")
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        # pow_x + pow_data in parallel (pow_data needs 2.6s dwell)
        px_future = None
        try:
            px = build_pow_x(work, base, m_ext)
            print(f"pow_x {px[:40]}... len={len(px)}")
        except Exception as e:
            print(f"pow_x fail {e}", file=sys.stderr); sys.exit(1)
        # start pow_data collect in background via subprocess (needs dwell)
        # build s.js file then spawn collect
        s_url = urljoin(base, s_sig)
        s_data, _ = fetch(s_url)
        (work / "s_signals.js").write_text(s_data, encoding="utf-8")
        subprocess.check_call(["node", str(BUILDER), str(work / "s_signals.js"), "signals"], cwd=str(work))
        # async collect start
        import threading
        pow_data_holder = {}
        def collect_thread():
            try:
                out = subprocess.check_output(["node", str(work / "run_payload.mjs")], text=True, cwd=str(work), timeout=20)
                for line in out.splitlines():
                    if line.startswith("COLLECT="):
                        pow_data_holder["data"] = line[8:]
                        break
                if "data" not in pow_data_holder:
                    pow_data_holder["err"] = out[-800:]
            except Exception as e:
                pow_data_holder["err"] = str(e)
        t = threading.Thread(target=collect_thread, daemon=True)
        t.start()

        # fetch cid
        yn = f"{random.getrandbits(40):x}{random.getrandbits(40):x}"
        cid = None
        for host in ["https://captcha.filecrypt.cc", "https://pow.filecrypt.cc", "https://v3-asia.cutcaptcha.net"]:
            try:
                body,_ = fetch(f"{host}/?t={yn}")
                j = json.loads(body)
                if j.get("cid"):
                    cid = j["cid"]; print(f"cid from {host}: {cid[:30]}..."); break
            except Exception as e:
                print(f"cid {host} err {e}")
                continue
        if not cid:
            print("no cid", file=sys.stderr); sys.exit(1)
        # POST session
        data = {"pow_x": px, "pow_y": cid, "pow_yn": yn, "tz": "Asia/Dhaka"}
        body,_ = fetch(urljoin(base, session_path), headers={"Origin": base, "Referer": container_url, "Accept":"*/*"}, data=data)
        print(f"challenge resp {body[:700]}")
        j = json.loads(body)
        c = j.get("challenge",{})
        chal = c.get("challenge"); diff = int(c.get("difficulty",0) or 0); cid_id = c.get("id","")
        if not chal:
            # fallback
            ch = j.get("challenge") or j
            if isinstance(ch, dict) and "challenge" in ch:
                chal = ch["challenge"]; diff = int(ch["difficulty"]); cid_id = ch.get("id","")
        if not chal:
            print(f"bad challenge json {j}", file=sys.stderr); sys.exit(1)
        print(f"solving PoW challenge={chal[:12]}... diff={diff} id={cid_id}")
        t0=time.time()
        nonce = solve_pow(chal, diff)
        ms=int((time.time()-t0)*1000)
        print(f"solved nonce={nonce} in {ms}ms")
        import hashlib
        h=hashlib.sha1(f"{chal}:{nonce}".encode()).hexdigest()
        v=int(h,16)
        lz = 160 - v.bit_length() if v else 160
        print(f"sha1 {h} lz={lz} need {diff} -> {'OK' if lz>=diff else 'FAIL'}")

        # wait for pow_data (if not done, wait)
        t.join(timeout=20)
        if "err" in pow_data_holder:
            print(f"pow_data fail {pow_data_holder['err']}", file=sys.stderr); sys.exit(1)
        pow_data = pow_data_holder.get("data","")
        print(f"pow_data len={len(pow_data)} {pow_data[:60]}...")
        # final POST to unlock
        elapsed = max(3200, ms + 3000)  # mimic dwell + solve
        form = {"pow_id": cid_id, "pow_nonce": str(nonce), "pow_elapsed": str(elapsed), "pow_pauses": "0", "pow_data": pow_data, "pow_x": px, "password": ""}
        # need proper headers: same as nav
        body, hdrs = fetch(container_url, headers={"Origin": base, "Referer": container_url, "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Content-Type":"application/x-www-form-urlencoded"}, data=form)
        if "confirm you're not a robot" in body or "I am a human" in body:
            print("submit REJECTED — still gated (TLS/fingerprint). Try browser fallback.", file=sys.stderr)
            # dump snippet
            print(body[body.find("I am a human")-500:body.find("I am a human")+500][:1000])
            sys.exit(3)
        # extract links
        links = re.findall(r'class="[^"]*dlhoster[^"]*"[^>]*href="([^"]+)"', body)
        if not links:
            links = re.findall(r'https?://[^\s"<>]*(?:pixeldrain|gofile|megaup|1fichier|ddownload|rapidgator|mega\.nz)[^\s"<>]*', body)
        uniq = []
        seen=set()
        for l in links:
            if l not in seen:
                seen.add(l); uniq.append(l)
        # also try CNL decrypt path: look for CNLPOP
        cnl_m = re.search(r"CNLPOP\('[^']*','([^']+)'[^']*'([^']+)'", body)
        if cnl_m:
            try:
                import base64
                from Crypto.Cipher import AES
                crypted, jk = cnl_m.groups()
                key = bytes.fromhex(jk)
                raw = base64.b64decode(crypted)
                iv = key
                cipher = AES.new(key, AES.MODE_CBC, iv)
                plain = cipher.decrypt(raw).decode(errors="ignore").strip("\x00\r\n ")
                cnl_links = [l.strip() for l in plain.split("\n") if l.strip()]
                print(f"CNL decrypted {len(cnl_links)} links")
                for l in cnl_links:
                    if l not in seen:
                        uniq.append(l); seen.add(l)
            except Exception as e:
                print(f"CNL decrypt err {e}")
        if not uniq:
            print("unlocked but no host links found", file=sys.stderr)
            print(body[:2000])
            sys.exit(1)
        print(f"UNLOCKED {len(uniq)} links:")
        for l in uniq:
            print(l)
