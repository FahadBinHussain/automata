// ==UserScript==
// @name         YouTube Watch Progress Tracker (Neon sync)
// @namespace    https://github.com/anomalyco/automata
// @version      0.4.1
// @description  Tracks how far you are into every YouTube video and syncs progress to a Neon Postgres database. Floating panel with a progress list and a settings tab, plus progress bars painted on video thumbnails.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      neon.tech
// ==/UserScript==

/*
 * SECURITY NOTE - READ THIS.
 *
 * The Settings tab stores a full Neon connection string in Tampermonkey
 * storage. That credential can read, modify and drop everything the role can
 * reach. Keeping it out of git does not make it safe, it only moves it into
 * your browser.
 *
 * Use a role scoped to this one table, never the project owner role:
 *
 *   create role yt_progress with login password '...';
 *   grant select, insert, update on watch_progress to yt_progress;
 *
 * Then paste the connection string for THAT role, not the owner one.
 */

(function () {
	"use strict";

	const TICK_MS = 5000;
	const FLUSH_MS = 120000;
	const FINISH_PCT = 0.9;
	const K_CONN = "neonConnStr";
	const K_CACHE = "progressCache";
	const NO_CONN_MSG = "no neon connection string - fill it in settings first";

	let cache = JSON.parse(GM_getValue(K_CACHE, "{}"));
	const K_DIRTY = "progressDirty";
	let dirty = new Set(JSON.parse(GM_getValue(K_DIRTY, "[]")));
	const saveDirty = () => GM_setValue(K_DIRTY, JSON.stringify([...dirty]));
	let bound = null;
	let lastWrite = 0;

	const connStr = () => GM_getValue(K_CONN, "").trim();
	const saveCache = () => GM_setValue(K_CACHE, JSON.stringify(cache));

	function neonHost(s) {
		try {
			return new URL(s.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
		} catch {
			return null;
		}
	}

	function neonQuery(query, params = []) {
		const cs = connStr();
		const host = neonHost(cs);
		if (!host) return Promise.reject(new Error("no connection string set"));
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: "POST",
				url: `https://${host}/sql`,
				headers: {
					"Content-Type": "application/json",
					"Neon-Connection-String": cs,
					"Neon-Raw-Text-Output": "true",
					"Neon-Array-Mode": "false",
				},
				data: JSON.stringify({ query, params }),
				onload: (r) => {
					if (r.status < 200 || r.status >= 300)
						return reject(new Error(`neon ${r.status}: ${r.responseText.slice(0, 200)}`));
					try {
						resolve(JSON.parse(r.responseText).rows || []);
					} catch (e) {
						reject(e);
					}
				},
				onerror: () => reject(new Error("network error")),
			});
		});
	}

	const SQL_UPSERT = `
insert into watch_progress (video_id, title, channel, position, duration, finished, updated_at)
values ($1, $2, $3, $4, $5, $6, now())
on conflict (video_id) do update set
  title      = excluded.title,
  channel    = excluded.channel,
  position   = greatest(watch_progress.position, excluded.position),
  duration   = excluded.duration,
  finished   = watch_progress.finished or excluded.finished,
  updated_at = now()`;

	async function flush() {
		if (!connStr() || dirty.size === 0) return;
		const ids = [...dirty];
		for (const id of ids) {
			const e = cache[id];
			if (!e) {
				dirty.delete(id);
				saveDirty();
				continue;
			}
			try {
				await neonQuery(SQL_UPSERT, [
					id,
					e.title,
					e.channel,
					Math.round(e.position),
					Math.round(e.duration),
					e.finished,
				]);
				dirty.delete(id);
				saveDirty();
			} catch (err) {
				console.warn("[yt-progress] flush failed", err);
				return; // keep dirty, retry next tick
			}
		}
		renderList();
	}

	async function pull() {
		if (!connStr()) throw new Error(NO_CONN_MSG);
		const rows = await neonQuery(
			"select video_id, title, channel, position, duration, finished, updated_at from watch_progress order by updated_at desc limit 200"
		);
		for (const r of rows) {
			const id = r.video_id;
			const remote = {
				title: r.title,
				channel: r.channel,
				position: Number(r.position),
				duration: Number(r.duration),
				finished: r.finished === true || r.finished === "t",
				updatedAt: r.updated_at,
			};
			const local = cache[id];
			cache[id] = local && local.position > remote.position ? local : remote;
		}
		saveCache();
		renderList();
		return rows.length;
	}

	let syncing = false;
	const PUSH_DEBOUNCE_MS = 5000;
	let pushTimer = null;

	function schedulePush() {
		if (!connStr()) return;
		clearTimeout(pushTimer);
		pushTimer = setTimeout(() => autoSync("progress"), PUSH_DEBOUNCE_MS);
	}

	async function autoSync(reason) {
		if (!connStr() || syncing) return;
		syncing = true;
		syncState("busy");
		try {
			record(true);
			for (const id of Object.keys(cache)) dirty.add(id);
			saveDirty();
			const pushing = dirty.size;
			await flush();
			if (dirty.size) throw new Error(`${dirty.size} of ${pushing} rows failed to upload`);
			const pulled = await pull();
			syncState("ok");
			status(`synced - pushed ${pushing}, ${pulled} rows in neon`);
		} catch (e) {
			syncState("fail");
			status(`sync failed - ${e.message}`);
			console.warn(`[yt-progress] autoSync(${reason}) failed`, e);
		} finally {
			syncing = false;
		}
	}

	// --- tracking ---------------------------------------------------------

	const videoId = () => new URLSearchParams(location.search).get("v");

	function meta() {
		const t =
			document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
			document.querySelector("h1.title");
		const c = document.querySelector("#owner #channel-name a, ytd-channel-name a");
		return {
			title: (t?.textContent || document.title.replace(/ - YouTube$/, "")).trim(),
			channel: (c?.textContent || "").trim() || null,
		};
	}

	function record(force) {
		const v = bound;
		const id = videoId();
		if (!v || !id || !v.duration || Number.isNaN(v.duration)) return;
		const now = Date.now();
		if (!force && now - lastWrite < TICK_MS) return;
		lastWrite = now;
		const m = meta();
		const pct = v.currentTime / v.duration;
		cache[id] = {
			title: m.title,
			channel: m.channel,
			position: v.currentTime,
			duration: v.duration,
			finished: pct >= FINISH_PCT,
			updatedAt: new Date().toISOString(),
		};
		dirty.add(id);
		saveCache();
		saveDirty();
		schedulePush();
	}

	function bind() {
		const v = document.querySelector("video");
		if (!v || v === bound) return;
		bound = v;
		v.addEventListener("timeupdate", () => record(false));
		v.addEventListener("pause", () => {
			record(true);
			flush();
		});
	}

	document.addEventListener("yt-navigate-finish", () => {
		bound = null;
		setTimeout(bind, 800);
	});
	window.addEventListener("beforeunload", () => record(true));
	setInterval(bind, 2000);
	setInterval(() => autoSync("tick"), FLUSH_MS);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") autoSync("focus");
		else {
			clearTimeout(pushTimer);
			autoSync("hidden");
		}
	});
	window.addEventListener("pagehide", () => {
		clearTimeout(pushTimer);
		record(true);
	});

	// --- ui ---------------------------------------------------------------

	const fmt = (s) => {
		s = Math.round(s);
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const x = s % 60;
		return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
	};

	const css = `
#ytp-btn{position:fixed;right:18px;bottom:18px;z-index:99999;width:44px;height:44px;border-radius:50%;
  background:#f00;color:#fff;border:0;cursor:grab;font:600 11px system-ui;box-shadow:0 2px 10px #0007;
  touch-action:none;user-select:none}
#ytp-btn.ytp-dragging{cursor:grabbing;opacity:.85}
#ytp-panel{position:fixed;right:18px;bottom:72px;z-index:99999;width:380px;max-height:70vh;display:none;
  flex-direction:column;background:#0f0f0f;color:#f1f1f1;border:1px solid #303030;border-radius:12px;
  font:13px system-ui;overflow:hidden}
#ytp-panel.open{display:flex;flex-direction:column;box-sizing:border-box;min-width:0}
#ytp-tabs{display:flex;border-bottom:1px solid #303030}
#ytp-tabs button{flex:1;padding:10px;background:none;border:0;color:#aaa;cursor:pointer;font:600 13px system-ui}
#ytp-tabs button.on{color:#fff;box-shadow:inset 0 -2px 0 #f00}
#ytp-panel,#ytp-panel *{box-sizing:border-box}
.ytp-body{overflow-y:auto;padding:10px 12px;display:none;width:100%}
.ytp-body.on{display:block}
.ytp-row{padding:8px 6px;border-bottom:1px solid #222;min-width:0;overflow:hidden}
.ytp-row a{color:#f1f1f1;text-decoration:none;display:block;line-height:1.3;margin-bottom:5px;
  min-width:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow-wrap:anywhere}
.ytp-row a:hover{color:#3ea6ff}
.ytp-bar{height:4px;background:#303030;border-radius:2px;overflow:hidden}
.ytp-bar i{display:block;height:100%;background:#f00}
.ytp-meta{color:#aaa;font-size:11px;margin-top:4px;display:flex;justify-content:space-between}
#ytp-conn{width:100%;box-sizing:border-box;background:#000;color:#f1f1f1;border:1px solid #303030;
  border-radius:6px;padding:8px;font:12px monospace}
.ytp-warn{background:#3a1d1d;border:1px solid #6b2b2b;color:#ffb4b4;padding:8px;border-radius:6px;
  font-size:11px;line-height:1.45;margin-bottom:10px}
.ytp-act{margin-top:10px;display:flex;gap:8px}
.ytp-act button{flex:1;padding:8px;border:0;border-radius:6px;cursor:pointer;font:600 12px system-ui;
  background:#272727;color:#f1f1f1}
.ytp-act button.p{background:#f00;color:#fff}
#ytp-status{margin-top:8px;font-size:11px;color:#aaa;min-height:14px}
#ytp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#555;transition:background .2s}
#ytp-dot.busy{background:#3ea6ff;animation:ytp-spin .8s linear infinite}
#ytp-dot.ok{background:#2ecc71}
#ytp-dot.fail{background:#e74c3c}
@keyframes ytp-spin{0%{opacity:.25}50%{opacity:1}100%{opacity:.25}}
.ytp-thumb-bar{position:absolute;left:0;right:0;bottom:8px;height:4px;background:#0009;z-index:2;pointer-events:none}
.ytp-thumb-bar i{display:block;height:100%;background:#f00;transition:width .2s}
.ytp-thumb-bar.done i{background:#909090}`;

	const style = document.createElement("style");
	style.textContent = css;
	document.head.appendChild(style);

	const btn = document.createElement("button");
	btn.id = "ytp-btn";
	btn.textContent = "YT\u25B6";
	btn.title = "Watch progress";

	// NOTE: YouTube enforces Trusted Types, so innerHTML is blocked on this
	// document. Everything below is built with real DOM nodes on purpose.
	// Do not "simplify" this back into innerHTML or the panel stops rendering.
	const el = (tag, props = {}, ...kids) => {
		const n = document.createElement(tag);
		for (const [k, v] of Object.entries(props)) {
			if (k === "class") n.className = v;
			else if (k === "text") n.textContent = v;
			else if (k === "style") Object.assign(n.style, v);
			else n.setAttribute(k, v);
		}
		for (const c of kids) if (c) n.append(c);
		return n;
	};

	const panel = el("div", { id: "ytp-panel" });

	const warn = el("div", { class: "ytp-warn" });
	warn.append(
		"This stores a full Postgres credential in browser storage. Use a role limited to ",
		el("code", { text: "watch_progress" }),
		", never the project owner role."
	);

	panel.append(
		el(
			"div",
			{ id: "ytp-tabs" },
			el("button", { "data-t": "list", class: "on", text: "Progress" }),
			el("button", { "data-t": "set", text: "Settings" })
		),
		el("div", { class: "ytp-body on", "data-b": "list" }),
		el(
			"div",
			{ class: "ytp-body", "data-b": "set" },
			warn,
			el("textarea", {
				id: "ytp-conn",
				rows: "4",
				spellcheck: "false",
				placeholder:
					"postgresql://yt_progress:...@ep-xxx.region.aws.neon.tech/neondb?sslmode=require",
			}),
			el(
				"div",
				{ class: "ytp-act" },
				el("button", { class: "p", "data-a": "save", text: "Save" }),
				el("button", { "data-a": "init", text: "Create table" }),
				el("button", { "data-a": "sync", text: "Sync now" })
			),
			el("div", { id: "ytp-status" }, el("i", { id: "ytp-dot" }), el("span", { text: "" }))
		)
	);

	document.body.append(btn, panel);

	const $ = (s) => panel.querySelector(s);
	const status = (m) => ($("#ytp-status").querySelector("span").textContent = m);

	let dotTimer = null;
	function syncState(s) {
		const dot = $("#ytp-dot");
		if (!dot) return;
		clearTimeout(dotTimer);
		dot.className = s === "idle" ? "" : s;
		if (s === "ok" || s === "fail") {
			dotTimer = setTimeout(() => (dot.className = ""), 2500);
		}
	}

	btn.onclick = () => {
		if (btn.dataset.dragged === "1") {
			delete btn.dataset.dragged;
			return; // a drag just ended, do not toggle the panel
		}
		panel.classList.toggle("open");
		if (panel.classList.contains("open")) renderList();
	};

	// --- draggable launcher (position synced to Neon) ----------------------

	const K_POS = "btnPos";
	const POS_KEY = "ytp-btn";
	const SQL_POS_UPSERT = `
insert into ui_prefs (key, x, y, updated_at)
values ($1, $2, $3, now())
on conflict (key) do update set
  x          = excluded.x,
  y          = excluded.y,
  updated_at = now()`;

	const clamp = (v, max) => Math.max(0, Math.min(v, max));

	function applyPos(p) {
		if (!p || typeof p.x !== "number" || typeof p.y !== "number") return;
		const x = clamp(p.x, innerWidth - btn.offsetWidth);
		const y = clamp(p.y, innerHeight - btn.offsetHeight);
		Object.assign(btn.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
		// keep the panel anchored to the button instead of the viewport corner
		const above = y > innerHeight / 2;
		Object.assign(panel.style, {
			left: `${clamp(x + btn.offsetWidth - 380, innerWidth - 380 - 8)}px`,
			right: "auto",
			top: above ? "auto" : `${y + btn.offsetHeight + 10}px`,
			bottom: above ? `${innerHeight - y + 10}px` : "auto",
		});
	}

	applyPos(JSON.parse(GM_getValue(K_POS, "null")));

	async function savePos(p) {
		GM_setValue(K_POS, JSON.stringify(p));
		if (!connStr()) return;
		try {
			await neonQuery(SQL_POS_UPSERT, [POS_KEY, Math.round(p.x), Math.round(p.y)]);
		} catch (err) {
			console.warn("[yt-progress] icon position sync failed", err);
		}
	}

	async function pullPos() {
		if (!connStr()) return;
		try {
			const rows = await neonQuery("select x, y from ui_prefs where key = $1", [POS_KEY]);
			if (!rows.length) return;
			const p = { x: Number(rows[0].x), y: Number(rows[0].y) };
			GM_setValue(K_POS, JSON.stringify(p));
			applyPos(p);
		} catch (err) {
			console.warn("[yt-progress] icon position pull failed", err);
		}
	}

	(function makeDraggable() {
		let id = null;
		let dx = 0;
		let dy = 0;
		let moved = false;

		btn.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			id = e.pointerId;
			moved = false;
			const r = btn.getBoundingClientRect();
			dx = e.clientX - r.left;
			dy = e.clientY - r.top;
			btn.setPointerCapture(id);
			btn.classList.add("ytp-dragging");
		});

		btn.addEventListener("pointermove", (e) => {
			if (id === null || e.pointerId !== id) return;
			if (!moved && Math.abs(e.movementX) + Math.abs(e.movementY) < 1) return;
			moved = true;
			applyPos({ x: e.clientX - dx, y: e.clientY - dy });
		});

		const end = (e) => {
			if (id === null || (e && e.pointerId !== id)) return;
			btn.releasePointerCapture(id);
			id = null;
			btn.classList.remove("ytp-dragging");
			if (!moved) return;
			btn.dataset.dragged = "1"; // suppress the click that follows a drag
			const r = btn.getBoundingClientRect();
			savePos({ x: r.left, y: r.top });
		};

		btn.addEventListener("pointerup", end);
		btn.addEventListener("pointercancel", end);
		addEventListener("resize", () =>
			applyPos(JSON.parse(GM_getValue(K_POS, "null")))
		);
	})();

	pullPos();

	panel.querySelectorAll("#ytp-tabs button").forEach((b) => {
		b.onclick = () => {
			panel.querySelectorAll("#ytp-tabs button").forEach((x) => x.classList.remove("on"));
			panel.querySelectorAll(".ytp-body").forEach((x) => x.classList.remove("on"));
			b.classList.add("on");
			panel.querySelector(`[data-b="${b.dataset.t}"]`).classList.add("on");
		};
	});

	$("#ytp-conn").value = connStr();

	panel.querySelector('[data-a="save"]').onclick = () => {
		GM_setValue(K_CONN, $("#ytp-conn").value.trim());
		status("saved");
	};

	panel.querySelector('[data-a="init"]').onclick = async () => {
		status("creating table...");
		try {
			await neonQuery(`create table if not exists watch_progress (
  video_id   text primary key,
  title      text not null,
  channel    text,
  position   integer not null,
  duration   integer not null,
  finished   boolean not null default false,
  updated_at timestamptz not null default now())`);
			await neonQuery(`create table if not exists ui_prefs (
  key        text primary key,
  x          integer not null,
  y          integer not null,
  updated_at timestamptz not null default now())`);
			status("tables ready");
		} catch (e) {
			status(String(e.message));
		}
	};

	panel.querySelector('[data-a="sync"]').onclick = async () => {
		if (!connStr()) {
			status("no neon connection string - fill it in settings first");
			return;
		}
		status("syncing...");
		await autoSync("manual");
	};

	function renderList() {
		const body = panel.querySelector('[data-b="list"]');
		const rows = Object.entries(cache).sort(
			(a, b) => new Date(b[1].updatedAt) - new Date(a[1].updatedAt)
		);
		body.replaceChildren();
		if (!rows.length) {
			body.append(
				el("div", {
					style: { color: "#aaa", padding: "12px" },
					text: "Nothing tracked yet.",
				})
			);
			return;
		}
		for (const [id, e] of rows) {
			const pct = Math.min(100, Math.round((e.position / e.duration) * 100)) || 0;
			body.append(
				el(
					"div",
					{ class: "ytp-row" },
					el("a", {
						href: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.floor(
							e.position
						)}s`,
						text: e.title,
					}),
					el("div", { class: "ytp-bar" }, el("i", { style: { width: `${pct}%` } })),
					el(
						"div",
						{ class: "ytp-meta" },
						el("span", { text: e.channel || "" }),
						el("span", {
							text: `${fmt(e.position)} / ${fmt(e.duration)} - ${pct}% (${Math.round(
								e.position
							)}s)${e.finished ? " done" : ""}`,
						}),
					)
				)
			);
		}
	}

	// --- thumbnail overlays -------------------------------------------------
	// Paints a red progress bar on every video thumbnail on the page, using the
	// same cache the panel reads from. Trusted Types safe: real DOM nodes only.

	// YouTube's newer lockup renderer uses camelCase classes
	// (ytLockupViewModelContentImage), not the dashed BEM-ish names the older
	// ytd-* renderers used. Keep both so home/search/sidebar all work.
	const THUMB_SEL = [
		"a#thumbnail[href*='/watch?v=']",
		"a.ytd-thumbnail[href*='/watch?v=']",
		"a.ytLockupViewModelContentImage[href*='/watch?v=']",
		"a.yt-lockup-view-model-wiz__content-image[href*='/watch?v=']",
	].join(",");

	function idFromHref(href) {
		try {
			return new URL(href, location.origin).searchParams.get("v");
		} catch {
			return null;
		}
	}

	function paintThumb(a) {
		const id = idFromHref(a.getAttribute("href") || "");
		const e = id && cache[id];
		// Anchor the overlay to the rendered <img> box. The <a> and its wrappers are
		// often wider than the painted image (letterboxing / stretched grid cell),
		// so we measure the image and offset the bar to match it exactly.
		const img = a.querySelector("yt-image img, #thumbnail img, img");
		const box = img?.parentElement || a;
		if (getComputedStyle(box).position === "static") box.style.position = "relative";
		let bar = box.querySelector(":scope > .ytp-thumb-bar");
		if (!e || !e.duration) {
			if (bar) bar.remove();
			return;
		}
		const pct = Math.min(100, Math.round((e.position / e.duration) * 100)) || 0;
		if (!bar) {
			bar = el("div", { class: "ytp-thumb-bar" }, el("i"));
			box.append(bar);
		}
		bar.classList.toggle("done", !!e.finished);
		bar.firstChild.style.width = `${pct}%`;
		bar.title = `${fmt(e.position)} / ${fmt(e.duration)} - ${pct}% (${Math.round(e.position)}s)`;
	}

	let paintQueued = false;
	function paintThumbs() {
		if (paintQueued) return;
		paintQueued = true;
		requestAnimationFrame(() => {
			paintQueued = false;
			document.querySelectorAll(THUMB_SEL).forEach(paintThumb);
		});
	}

	new MutationObserver(paintThumbs).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	document.addEventListener("yt-navigate-finish", () => setTimeout(paintThumbs, 500));
	setInterval(paintThumbs, 3000);

	bind();
	pull()
		.then(paintThumbs)
		.catch((err) => {
			if (err && err.message === NO_CONN_MSG) return;
			console.warn("[yt-progress] initial pull failed", err);
		});
	paintThumbs();
})();
