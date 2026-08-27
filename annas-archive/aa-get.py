import asyncio, sys, json, re

import nodriver as uc

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

async def evaluate_str(tab, expr):
    try:
        v = await tab.evaluate(expr)
        return v if isinstance(v, str) else ""
    except Exception:
        return ""

async def wait_ddg_pass(tab, timeout_loops=60):
    for i in range(timeout_loops):
        await asyncio.sleep(2)
        t = await evaluate_str(tab, "document.title")
        b = await evaluate_str(tab, "(document.body.innerText||'').slice(0,150)")
        if t and "DDoS-Guard" not in t and "Please wait a few seconds" not in b:
            return True
    return False

async def get_md5(md5: str):
    url = f"https://annas-archive.pk/md5/{md5}"
    browser = await uc.start(browser_executable_path=EDGE, headless=False)
    try:
        tab = await browser.get(url, new_tab=True)
        await asyncio.sleep(5)
        if not await wait_ddg_pass(tab):
            print("FAILED: DDoS-Guard did not auto-pass")
            return
        await asyncio.sleep(3)
        title = await evaluate_str(tab, "document.title")
        print(f"PASSED DDG. page: {title[:100]}")

        # collect fast + slow download URLs
        fast = await evaluate_str(tab, """JSON.stringify([...document.querySelectorAll('a[href*="fast_download"]')].map(a=>a.href))""")
        slow = await evaluate_str(tab, """JSON.stringify([...document.querySelectorAll('a[href*="slow_download"]')].map(a=>({t:a.textContent.trim().slice(0,40),h:a.href})))""")
        print("FAST:", fast)
        print("SLOW:", slow)

        # open a slow partner (prefer no-waitlist #5+) and pull the direct IP link
        direct = None
        slow_links = json.loads(slow) if slow else []
        # find slow server #5 or later (no waitlist) else fall back to first
        chosen = None
        for s in slow_links:
            try:
                n = int(s["t"].replace("Slow Partner Server #", "").strip())
            except Exception:
                n = 0
            if n >= 5:
                chosen = s["h"]
                break
        if chosen is None and slow_links:
            chosen = slow_links[0]["h"]
        if chosen:
            print("OPENING:", chosen)
            tab2 = await browser.get(chosen, new_tab=True)
            await asyncio.sleep(5)
            await wait_ddg_pass(tab2)
            await asyncio.sleep(12)
            html = await evaluate_str(tab2, "document.documentElement.outerHTML")
            # the direct file URL appears in the html (partner IP server)
            pdfs = re.findall(r'(https?://[^"\' <>]+\.pdf[^"\' <>]*)', html)
            for u in dict.fromkeys(pdfs):
                # skip the &quot;-suffixed duplicates
                if "&quot;" in u or ').then' in u:
                    continue
                if u.startswith("http://") or u.startswith("https://"):
                    direct = u
                    break
        if direct:
            print("DIRECT_URL=" + direct)
        else:
            print("NO DIRECT URL FOUND")
    finally:
        try:
            browser.stop()
        except Exception:
            pass

if __name__ == "__main__":
    md5 = sys.argv[1] if len(sys.argv) > 1 else "1a1566ba5e912d2b6252ee16dab252d5"
    asyncio.run(get_md5(md5))
