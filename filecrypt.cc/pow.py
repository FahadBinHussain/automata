"""
filecrypt.cc PoW — offline solver (deepseek4free-style)
reverses pow_captcha_worker.js 1a1fb8d7 SHA1 leading-zero PoW

worker logic:
  prefix = challenge + ":"
  find nonce >=0 where sha1(prefix + str(nonce)) has >= difficulty leading zero BITS
  difficulty ~20-24 (2^diff expected hashes)
pure python native hashlib is ~50x faster than JS Worker (40k/s -> 2M/s per core)
"""

import hashlib
import os
import time
import multiprocessing

def sha1_lz(s: str) -> int:
    h = hashlib.sha1(s.encode()).digest()
    # count leading zero bits
    v = int.from_bytes(h, 'big')
    if v == 0:
        return 160
    return 160 - v.bit_length()

def sha1_lz_bytes(b: bytes) -> int:
    h = hashlib.sha1(b).digest()
    v = int.from_bytes(h, 'big')
    if v == 0:
        return 160
    return 160 - v.bit_length()

def solve_single(challenge: str, difficulty: int, start: int = 0, step: int = 1, limit: int = 1 << 32):
    prefix = (challenge + ":").encode()
    # pre-encode prefix, then append nonce bytes
    for nonce in range(start, limit, step):
        # encode nonce as decimal ascii like JS String(nonce)
        b = prefix + str(nonce).encode()
        if sha1_lz_bytes(b) >= difficulty:
            return nonce
    return None

def _worker(challenge, difficulty, start, step, limit, q):
    prefix = (challenge + ":").encode()
    for nonce in range(start, limit, step):
        b = prefix + str(nonce).encode()
        h = hashlib.sha1(b).digest()
        v = int.from_bytes(h, 'big')
        lz = 160 - v.bit_length() if v else 160
        if lz >= difficulty:
            q.put(nonce)
            return
        if nonce % 500000 == 0 and not q.empty():
            return

def solve(challenge: str, difficulty: int, workers: int = 0):
    """solve filecrypt PoW, returns {nonce, hashes, ms} — parallel like deepseek WASM"""
    if workers == 0:
        workers = os.cpu_count() or 4
    if workers == 1:
        t0 = time.time()
        nonce = solve_single(challenge, difficulty)
        ms = int((time.time() - t0)*1000)
        return {"nonce": nonce, "hashes": nonce+1 if nonce is not None else 0, "ms": ms}
    # multi
    ctx = multiprocessing.get_context("spawn")
    q = ctx.Queue()
    procs = []
    t0 = time.time()
    for i in range(workers):
        p = ctx.Process(target=_worker, args=(challenge, difficulty, i, workers, 1 << 32, q))
        p.daemon = True
        p.start()
        procs.append(p)
    nonce = q.get()  # blocks till one finds it
    ms = int((time.time() - t0)*1000)
    for p in procs:
        p.terminate()
        p.join(timeout=0.5)
    # verify nonce is minimal? workers race, so we may get non-minimal nonce (any valid is accepted by server)
    # to get minimal, re-scan from 0 to found nonce single-threaded
    # filecrypt accepts any valid nonce, not necessarily minimal, so return as-is
    return {"nonce": nonce, "hashes": nonce+1, "ms": ms, "workers": workers}

if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser(description="filecrypt sha1 PoW solver")
    ap.add_argument("challenge", help="challenge hex from captchasession json")
    ap.add_argument("difficulty", type=int, help="difficulty bits e.g. 24")
    ap.add_argument("--workers", type=int, default=0, help="parallel workers (0=auto)")
    args = ap.parse_args()
    r = solve(args.challenge, args.difficulty, workers=args.workers)
    print(json.dumps(r))
