import asyncio, sys, json, os

import nodriver as uc

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

async def evaluate_str(tab, expr):
    try:
        v = await tab.evaluate(expr)
        return v if isinstance(v, str) else ""
    except Exception:
        return ""

async def wait_ddg_pass(tab, timeout_loops=60):
    """wait until DDoS-Guard's JS challenge resolves (title stops being 'DDoS-Guard')."""
    for i in range(timeout_loops):
        await asyncio.sleep(2)
        t = await evaluate_str(tab, "document.title")
        b = await evaluate_str(tab, "(document.body.innerText||'').slice(0,150)")
        if t and "DDoS-Guard" not in t and "Please wait a few seconds" not in b:
            return True
    return False

async def bypass(url: str, dump_text: str = None):
    """open a DDoS-Guard-protected URL with nodriver+Edge, pass the JS challenge,
    then print the landed URL + cookies and optionally dump body text to a file."""
    browser = await uc.start(browser_executable_path=EDGE, headless=False)
    try:
        tab = await browser.get(url, new_tab=True)
        await asyncio.sleep(5)
        if not await wait_ddg_pass(tab):
            print("FAILED: DDoS-Guard did not auto-pass (fingerprint rejected -> hCaptcha?)")
            return 1
        await asyncio.sleep(2)
        final_url = await evaluate_str(tab, "location.href")
        title = await evaluate_str(tab, "document.title")
        cookies = await evaluate_str(tab, "document.cookie")
        print(f"PASSED DDG")
        print(f"URL={final_url}")
        print(f"TITLE={title}")
        print(f"COOKIES={cookies}")
        if dump_text:
            text = await evaluate_str(tab, "document.body.innerText")
            with open(dump_text, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"TEXT_DUMPED={dump_text} ({len(text)} chars)")
        return 0
    finally:
        try:
            browser.stop()
        except Exception:
            pass

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: ddg-bypass.py <url> [--dump <out.txt>]")
        sys.exit(2)
    url = sys.argv[1]
    dump = None
    if "--dump" in sys.argv:
        i = sys.argv.index("--dump")
        if i + 1 < len(sys.argv):
            dump = sys.argv[i + 1]
    sys.exit(asyncio.run(bypass(url, dump)))
