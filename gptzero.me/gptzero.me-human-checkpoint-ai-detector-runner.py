#!/usr/bin/env python
"""Human-checkpoint GPTZero runner for Jarvis-style automation.

This does not bypass hCaptcha. It opens the real browser flow, pauses while the
human solves any challenge, then resumes the scan and saves a redacted result.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright


LANDING_URL = "https://gptzero.me/"
APP_SCAN_URL = "https://app.gptzero.me/?scanType=basic&source=landing&triggerScan=true"
DEFAULT_PROFILE_DIR = Path(
    os.environ.get("LOCALAPPDATA", str(Path.home()))
) / "JarvisBrowserProfiles" / "gptzero"
DEFAULT_OUTPUT_DIR = Path(
    os.environ.get("LOCALAPPDATA", str(Path.home()))
) / "JarvisRuns" / "gptzero"

SENSITIVE_KEY = re.compile(r"(token|cookie|secret|password|csrf|captcha)", re.I)
TEXT_VALUE_KEY = re.compile(
    r"(^document$|text|content|input|payload|excerpt|sentence|paragraph)",
    re.I,
)


def redact(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "..."
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            should_hide = SENSITIVE_KEY.search(key_text) or (
                TEXT_VALUE_KEY.search(key_text) and isinstance(item, str)
            )
            if should_hide:
                if isinstance(item, str):
                    out[key] = f"<string len={len(item)}>"
                else:
                    out[key] = f"<{type(item).__name__}>"
            else:
                out[key] = redact(item, depth + 1)
        return out
    if isinstance(value, list):
        return [redact(item, depth + 1) for item in value[:10]]
    if isinstance(value, str) and len(value) > 500:
        return f"<string len={len(value)}>"
    return value


def safe_parse_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return redact(json.loads(raw))
    except Exception:
        return f"<raw len={len(raw)}>"


async def body_text(page: Page) -> str:
    try:
        return await page.locator("body").inner_text(timeout=1500)
    except Exception:
        return ""


async def has_active_hcaptcha(page: Page) -> bool:
    text = await body_text(page)
    challenge_words = (
        "Click on things",
        "Please click",
        "hCaptcha",
        "I am human",
        "Verify you are human",
    )
    if any(word.lower() in text.lower() for word in challenge_words):
        return True

    try:
        frames = [frame.url for frame in page.frames]
    except Exception:
        frames = []
    if any("hcaptcha.com" in url for url in frames):
        # The checkbox iframe can remain around briefly; only treat it as active
        # if the app has not loaded a usable scan input yet.
        return not await has_usable_scan_input(page)
    return False


async def has_usable_scan_input(page: Page) -> bool:
    for selector in ("textarea", "[contenteditable='true']"):
        loc = page.locator(selector)
        count = await loc.count()
        for idx in range(min(count, 8)):
            item = loc.nth(idx)
            try:
                if await item.is_visible(timeout=500):
                    box = await item.bounding_box()
                    if box and box["width"] > 150 and box["height"] > 40:
                        return True
            except Exception:
                continue
    return False


async def click_landing_scan(page: Page, text: str) -> Page:
    await page.goto(LANDING_URL, wait_until="domcontentloaded", timeout=60_000)
    await page.wait_for_timeout(3500)

    textarea = page.locator("textarea").first
    await textarea.wait_for(state="visible", timeout=45_000)
    await textarea.fill(text)
    await page.wait_for_timeout(500)

    handle = await page.evaluate_handle(
        """() => {
            const ta = document.querySelector('textarea');
            let root = ta;
            for (let i = 0; i < 8 && root; i++, root = root.parentElement) {
                const btn = [...root.querySelectorAll('button')]
                    .find((b) => b.innerText && b.innerText.trim() === 'Scan');
                if (btn) return btn;
            }
            return null;
        }"""
    )
    button = handle.as_element()
    if not button:
        raise RuntimeError("Could not find GPTZero landing scan button")

    async with page.expect_popup(timeout=15_000) as popup_info:
        await button.click(timeout=10_000)
    popup = await popup_info.value
    await popup.wait_for_load_state("domcontentloaded", timeout=60_000)
    return popup


async def wait_for_checkpoint(page: Page, timeout_ms: int) -> str:
    await page.bring_to_front()
    deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
    announced = False

    while asyncio.get_running_loop().time() < deadline:
        if await has_usable_scan_input(page):
            return "scan-input-ready"
        if await has_active_hcaptcha(page):
            if not announced:
                print(
                    "[checkpoint] hCaptcha is active in the browser. "
                    "Solve it manually; Jarvis will resume automatically."
                )
                announced = True
            await page.bring_to_front()
        await page.wait_for_timeout(1500)

    raise TimeoutError("Timed out waiting for manual checkpoint to clear")


async def fill_app_scan_input(page: Page, text: str) -> bool:
    priority_selectors = (
        "textarea[placeholder*='AI involvement']",
        "textarea[placeholder*='minimum 250']",
        "textarea[placeholder*='check']",
        "[contenteditable='true'][data-placeholder*='AI']",
        "[contenteditable='true'][aria-label*='AI']",
    )
    for selector in (*priority_selectors, "textarea", "[contenteditable='true']"):
        loc = page.locator(selector)
        count = await loc.count()
        for idx in range(min(count, 8)):
            item = loc.nth(idx)
            try:
                if not await item.is_visible(timeout=800):
                    continue
                box = await item.bounding_box()
                if not box or box["width"] < 150 or box["height"] < 40:
                    continue
                if selector == "textarea":
                    await item.fill(text, timeout=15_000)
                else:
                    await item.click(timeout=5_000)
                    await page.keyboard.press("Control+A")
                    await page.keyboard.insert_text(text)
                return True
            except Exception:
                continue
    return False


async def click_app_scan_button(page: Page) -> bool:
    button_names = (
        r"^scan$",
        r"scan\s+for\s+ai",
        r"check\s+ai",
        r"check\s+for\s+ai",
        r"check\s+origin",
        r"detect\s+ai",
        r"start\s+scan",
        r"run\s+scan",
    )
    for pattern in button_names:
        loc = page.get_by_role("button", name=re.compile(pattern, re.I)).first
        try:
            if await loc.count() and await loc.is_visible(timeout=1000):
                await loc.click(timeout=10_000)
                return True
        except Exception:
            continue
    return False


async def maybe_resume_scan(page: Page, text: str) -> None:
    # The landing page tries to send text through postMessage. If that timed out
    # while the user solved hCaptcha, fill the dashboard input directly.
    await page.wait_for_timeout(1500)
    if await fill_app_scan_input(page, text):
        await page.wait_for_timeout(500)
        clicked = await click_app_scan_button(page)
        print(f"[resume] filled app input; scan button clicked={clicked}")
    else:
        print("[resume] no usable app input found; assuming landing postMessage handled the scan")


async def save_screenshot(page: Page, output_dir: Path, name: str) -> str | None:
    try:
        path = output_dir / f"{name}.png"
        await page.screenshot(path=str(path), full_page=False)
        return str(path)
    except Exception as exc:
        print(f"[screenshot] failed for {name}: {exc}")
        return None


async def visible_status_lines(page: Page) -> list[str]:
    text = await body_text(page)
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or len(line) > 220:
            continue
        if re.search(
            r"(scan|ai|human|generated|login|sign|captcha|error|result|score|limit|upgrade|email)",
            line,
            re.I,
        ):
            if line not in lines:
                lines.append(line)
    return lines[:100]


def scan_summary(scan_response: dict[str, Any]) -> dict[str, Any] | None:
    body = scan_response.get("body") if scan_response else None
    if not isinstance(body, dict):
        return None
    documents = body.get("documents")
    if not isinstance(documents, list) or not documents:
        return None
    doc = documents[0]
    if not isinstance(doc, dict):
        return None
    return {
        "version": body.get("version"),
        "scanId": body.get("scanId"),
        "predicted_class": doc.get("predicted_class"),
        "document_classification": doc.get("document_classification"),
        "result_message": doc.get("result_message"),
        "confidence_score": doc.get("confidence_score"),
        "confidence_category": doc.get("confidence_category"),
        "average_generated_prob": doc.get("average_generated_prob"),
        "completely_generated_prob": doc.get("completely_generated_prob"),
        "class_probabilities": doc.get("class_probabilities"),
    }


async def run(args: argparse.Namespace) -> int:
    text = Path(args.text_file).read_text(encoding="utf-8")
    output_dir = Path(args.output_dir)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = output_dir / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    captured: list[dict[str, Any]] = []
    scan_response_event = asyncio.Event()
    scan_response: dict[str, Any] = {}
    scan_request_event = asyncio.Event()
    screenshots: list[str] = []

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(Path(args.profile_dir)),
            headless=False,
            viewport={"width": 1365, "height": 900},
            accept_downloads=True,
        )

        async def on_request(request):
            if "api.gptzero.me" not in request.url:
                return
            entry: dict[str, Any] = {
                "phase": "request",
                "method": request.method,
                "url": request.url,
                "resource_type": request.resource_type,
            }
            try:
                entry["body"] = safe_parse_json(request.post_data)
            except Exception:
                entry["body"] = "<unreadable>"
            captured.append(entry)
            if "/v3/scan" in request.url or "/v3/ai/text" in request.url:
                scan_request_event.set()

        async def on_response(response):
            if "api.gptzero.me" not in response.url:
                return
            entry: dict[str, Any] = {
                "phase": "response",
                "status": response.status,
                "url": response.url,
                "resource_type": response.request.resource_type,
            }
            try:
                raw = await response.text()
                entry["body"] = safe_parse_json(raw)
            except Exception as exc:
                entry["body_error"] = str(exc)
            captured.append(entry)
            if "/v3/ai/text" in response.url:
                scan_response.update(entry)
                scan_response_event.set()

        context.on("request", lambda request: asyncio.create_task(on_request(request)))
        context.on("response", lambda response: asyncio.create_task(on_response(response)))

        landing = context.pages[0] if context.pages else await context.new_page()
        popup = await click_landing_scan(landing, text)
        print(f"[browser] opened {popup.url}")
        shot = await save_screenshot(popup, run_dir, "01-popup-opened")
        if shot:
            screenshots.append(shot)

        try:
            state = await wait_for_checkpoint(popup, args.checkpoint_timeout_ms)
            print(f"[checkpoint] cleared: {state}")
        except TimeoutError as exc:
            print(f"[checkpoint] {exc}")
        shot = await save_screenshot(popup, run_dir, "02-after-checkpoint")
        if shot:
            screenshots.append(shot)

        await maybe_resume_scan(popup, text)
        shot = await save_screenshot(popup, run_dir, "03-after-resume-attempt")
        if shot:
            screenshots.append(shot)

        try:
            await asyncio.wait_for(scan_request_event.wait(), timeout=10)
            print("[trace] scan-related request observed")
        except asyncio.TimeoutError:
            print("[trace] no scan-related request observed")

        try:
            await asyncio.wait_for(scan_response_event.wait(), timeout=args.result_timeout_ms / 1000)
            print("[result] captured /v3/ai/text response")
        except asyncio.TimeoutError:
            print("[result] no /v3/ai/text response captured before timeout")
        if scan_response:
            summary = scan_summary(scan_response)
            if summary:
                print(f"[verdict] {json.dumps(summary, ensure_ascii=True)}")
            await popup.wait_for_timeout(args.ui_settle_ms)
        shot = await save_screenshot(popup, run_dir, "04-before-close")
        if shot:
            screenshots.append(shot)

        out_path = run_dir / "result.json"
        payload = {
            "landing_url": LANDING_URL,
            "popup_url": popup.url,
            "profile_dir": str(Path(args.profile_dir)),
            "screenshots": screenshots,
            "visible_status_lines": await visible_status_lines(popup),
            "summary": scan_summary(scan_response) if scan_response else None,
            "scan_response": scan_response or None,
            "captured_api_events": captured,
        }
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"[saved] {out_path}")

        if args.keep_open:
            print("[browser] keeping browser open. Close it when you are done.")
            while True:
                await asyncio.sleep(3600)
        await context.close()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run GPTZero with a human hCaptcha checkpoint.")
    parser.add_argument("text_file", help="Text file to scan")
    parser.add_argument("--profile-dir", default=str(DEFAULT_PROFILE_DIR))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--checkpoint-timeout-ms", type=int, default=10 * 60 * 1000)
    parser.add_argument("--result-timeout-ms", type=int, default=2 * 60 * 1000)
    parser.add_argument("--ui-settle-ms", type=int, default=8_000)
    parser.add_argument("--keep-open", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
