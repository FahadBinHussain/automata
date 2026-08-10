// ==UserScript==
// @name         YouTube Watch Progress Tracker (Neon sync)
// @namespace    https://github.com/anomalyco/automata
// @version      0.5.14
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
	// seconds of tolerance: only a position within half a second of the end
	// counts as fully watched, so "done" (cyan) means actually finished
	// ~6s slack: youtube clamps the last few seconds of a video off the
	// seekable range, so a seek to the very end lands short of `duration`
	// (e.g. 2:36:07 of 2:36:12) and must still count as finished
	const FINISH_TOL = 6;

	// The real playable end, not the metadata duration: youtube's seekable
	// range stops a couple seconds before `duration`, and `duration` itself
	// can be NaN/infinity before load and on live content.
	function seekEnd(v) {
		const s = v.seekable;
		const end = s && s.length ? s.end(s.length - 1) : v.duration;
		return end && Number.isFinite(end) && end > 0 ? end : v.duration;
	}

	// "1:02:07" (or "0:42") -> seconds, matching what the player actually
	// shows - the video element's own getters are the unreliable part here.
	function clockToSecs(t) {
		if (!t) return NaN;
		const p = String(t).trim().split(":").map(Number);
		if (!p.length || p.some((n) => Number.isNaN(n))) return NaN;
		return p.reduce((a, b) => a * 60 + b, 0);
	}

	// The player flips the whole container into ended-mode when the video is
	// truly done, and its own clock reads cur == dur then. Both are what the
	// user actually sees, so use them as the finished signal - the element's
	// currentTime can clamp short of duration and never fire `ended` on a
	// paused seek. No tolerance here: 1s left is still green.
	function playerEnded() {
		if (document.querySelector(".html5-video-player.ended-mode")) return true;
		const c = document.querySelector(".ytp-time-current");
		const d = document.querySelector(".ytp-time-duration");
		const cur = c ? clockToSecs(c.textContent) : NaN;
		const dur = d ? clockToSecs(d.textContent) : NaN;
		return Number.isFinite(dur) && dur > 0 && Number.isFinite(cur) && cur >= dur;
	}
	const K_CONN = "neonConnStr";
	const K_CACHE = "progressCache";
	const NO_CONN_MSG = "no neon connection string - fill it in settings first";

	let cache = JSON.parse(GM_getValue(K_CACHE, "{}"));
	const K_DIRTY = "progressDirty";
	let dirty = new Set(JSON.parse(GM_getValue(K_DIRTY, "[]")));
	const saveDirty = () => GM_setValue(K_DIRTY, JSON.stringify([...dirty]));
	let bound = null;
	let lastWrite = 0;

	// Persistent ring-buffer event log. Every state-changing decision (record,
	// flush, merge, load re-derivation, seek) writes a line here so a progress
	// revert can be traced to the exact event that caused it instead of
	// guessing. Survives reloads; visible in the panel's Log tab and console.
	const K_LOG = "progressLog";
	let logBuf = JSON.parse(GM_getValue(K_LOG, "[]"));
	function log(...parts) {
		logBuf.push({ t: Date.now(), msg: parts.join(" ") });
		if (logBuf.length > 500) logBuf = logBuf.slice(-500);
		GM_setValue(K_LOG, JSON.stringify(logBuf));
		console.log("[yt-progress]", parts.join(" "));
	}

	// Re-derive `finished` from position/duration on load: older builds flagged
	// videos as done at 90% watched, so a stale cache would keep painting cyan
	// on entries that never reached the end until they were re-watched.
	// Strict: only a pinned end position survives - a video with 1s left is
	// green, not done.
	for (const id of Object.keys(cache)) {
		const e = cache[id];
		if (e && e.duration && !(e.position >= e.duration - 0.5)) {
			e.finished = false;
			dirty.add(id);
			log(
				`loadfix v=${id} finished cleared (p=${Math.round(e.position)} d=${Math.round(e.duration)})`
			);
		}
	}

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
values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
on conflict (video_id) do update set
  title      = excluded.title,
  channel    = excluded.channel,
  -- Last-write-wins, not greatest(): seeking backwards has to be able to move
  -- the resume point earlier. greatest() pinned it to the furthest point reached.
  position   = excluded.position,
  duration   = excluded.duration,
  finished   = watch_progress.finished or excluded.finished,
  -- Store when the video was actually watched, not when the row happened to
  -- sync. Pushes are debounced and retried, so now() drifted later than
  -- reality and could sort a row above something watched after it. greatest()
  -- keeps the timestamp monotonic if an older queued write arrives late.
  updated_at = greatest(watch_progress.updated_at, coalesce($7::timestamptz, now()))`;

	async function flush() {
		if (!connStr() || dirty.size === 0) return 0;
		const ids = [...dirty];
		let ok = 0;
		let fail = 0;
		for (const id of ids) {
			const e = cache[id];
			if (!e) {
				dirty.delete(id);
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
					// Send the watch time recorded locally. Entries written by older
					// versions of the script have no updatedAt at all, so pass null and
					// let the server fall back to now() rather than sending undefined.
					e.updatedAt || null,
				]);
				dirty.delete(id);
				ok++;
			} catch (err) {
				// One failing row must not abort the queue: `return` used to stop
				// the loop on the first error, so every row behind it stayed
				// unsynced - and when the same row kept failing (rate limit, bad
				// title) the rows behind it were starved forever. Every row gets
				// its own attempt on every pass; only the failing ones stay dirty.
				fail++;
				log(
					`flush fail v=${id} (p=${Math.round(e.position)} d=${Math.round(e.duration)} fin=${e.finished}): ${String(err && err.message).slice(0, 120)}`
				);
				console.warn("[yt-progress] flush failed for " + id, err);
			}
		}
		saveDirty();
		renderList();
		if (ids.length) log(`flush ok=${ok} fail=${fail} left=${dirty.size}`);
		return ok;
	}

	// Neon's HTTP API is not consistent about how it serializes booleans, so a
	// finished row can arrive as true, "t", "true", or 1. Anything other than a
	// real false made the video look unwatched on thumbnails.
	function truthy(v) {
		if (typeof v === "boolean") return v;
		if (typeof v === "number") return v !== 0;
		if (typeof v === "string") return ["t", "true", "1", "y", "yes"].includes(v.trim().toLowerCase());
		return false;
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
				finished: truthy(r.finished),
				updatedAt: r.updated_at,
			};
			const local = cache[id];
			// Merge field-by-field instead of picking one row wholesale: picking the
			// higher-position row silently dropped finished=true whenever the other
			// row had an equal or higher position, which painted 0% bars on videos
			// that were fully watched.
			if (!local) {
				cache[id] = remote;
				if (remote.finished)
					log(
						`adopt v=${id} finished row from neon (p=${Math.round(remote.position)} d=${Math.round(remote.duration)})`
					);
			} else {
				// Pick the more recently written row, not the further-along one. Position
				// is last-write-wins now, so a rewind has to be able to win over a higher
				// position recorded earlier.
				const base = ts(local.updatedAt) >= ts(remote.updatedAt) ? local : remote;
				const dur = remote.duration || local.duration || 0;
				const merged = {
					...base,
					position: base.position || 0,
					duration: dur,
					// Done stays done: a teardown/partial row that is newer must not
					// un-finish a video the player (or the DB) already marked finished.
					// Either side's finished flag wins when the position is at or near
					// the end (clamped seeks land within FINISH_TOL of duration); the
					// strict end-position check still applies everywhere else, so
					// legacy rows flagged finished at 90% watched get cleaned up.
					finished:
						base.position >= dur - 0.5 ||
						((remote.finished || local.finished) && base.position >= dur - FINISH_TOL),
					// Keep the newer timestamp. Spreading `base` inherited updatedAt from
					// whichever row had the higher position, which could be the older one,
					// and that stale value then decided the list order.
					updatedAt:
						ts(local.updatedAt) >= ts(remote.updatedAt)
							? local.updatedAt
							: remote.updatedAt,
				};
				if (
					Math.abs((merged.position || 0) - (local.position || 0)) > 0.5 ||
					merged.finished !== local.finished ||
					merged.duration !== (local.duration || 0)
				) {
					log(
						`merge v=${id} p ${Math.round(local.position || 0)}->${Math.round(merged.position)} d ${Math.round(local.duration || 0)}->${Math.round(merged.duration)} fin ${local.finished}->${merged.finished} base=${base === local ? "local" : "remote"}`
					);
				}
				cache[id] = merged;
			}
		}
		saveCache();
		renderList();
		return rows.length;
	}

	let syncing = false;
	const PUSH_DEBOUNCE_MS = 5000;
	const RETRY_MS = 30000;
	let pushTimer = null;
	let retryTimer = null;

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
			record(true, "autosync");
			// Only the pending dirt rows go up. Sweeping the whole cache into the
			// queue each time turned every 5s debounce into a re-upload of all
			// videos, which tripped neon's rate limit and made flushes fail.
			const pushing = dirty.size;
			const ok = await flush();
			if (dirty.size) {
				clearTimeout(retryTimer);
				retryTimer = setTimeout(() => autoSync("retry"), RETRY_MS);
				throw new Error(
					`${dirty.size} of ${pushing} rows failed to upload (${ok} ok), retrying in ${RETRY_MS / 1000}s`
				);
			}
			const pulled = await pull();
			syncState("ok");
			status(`synced - pushed ${ok}, ${pulled} rows in neon`);
			log(`autosync ${reason}: pushed ${ok}, pulled ${pulled} rows`);
		} catch (e) {
			syncState("fail");
			status(`sync failed - ${e.message}`);
			log(`autosync ${reason} failed: ${String(e.message).slice(0, 200)}`);
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

	function record(force, why) {
		const v = bound;
		const id = videoId();
		if (!v || !id || !v.duration || Number.isNaN(v.duration)) return;
		const now = Date.now();
		if (!force && now - lastWrite < TICK_MS) return;
		lastWrite = now;
		const m = meta();
		const pct = v.currentTime / v.duration;
		const prev = cache[id];
		// A currentTime that has snapped back to ~0 is almost never a real seek: it
		// is the player being torn down, or autoplay loading the next video into the
		// same <video> element before location.href catches up. Writing that would
		// clobber a finished entry down to 0, so drop it and keep what we had.
		if (v.currentTime < 1 && prev && prev.position > 5) {
			log(
				`record skip v=${id} ct=${v.currentTime.toFixed(2)} (teardown guard, kept p=${Math.round(prev.position)} fin=${prev.finished}) why=${why || "?"}`
			);
			return;
		}
		// Position is last-write-wins: whatever you were last at is the resume
		// point, even if you seeked backwards. This used to take max(prev, current),
		// which meant rewinding then leaving the page kept the furthest-forward time.
		// `finished` is derived, not sticky: only a position at the very end of the
		// video counts, so rewinding after the credits clears the "done" mark.
		const sameVideo = prev && Math.abs((prev.duration || 0) - v.duration) < 1;
		// Finished means the player itself says the video ended: `ended` on the
		// element, or the player's own UI (ended-mode / clock at duration).
		// Position-based tolerance was wrong - a video with 1s left must stay
		// green, not flip to done.
		const atEnd = v.ended || playerEnded();
		// A finished entry must survive teardown noise. The last write before the
		// page goes away (pagehide/beforeunload, autoplay swapping the next video
		// into this element, a final clamped timeupdate) often lands a hair under
		// duration with no `ended` signal and no ended-mode - and that used to
		// clobber `finished` back to false, so the thumbnail went partial on the
		// next load even though the video was fully watched. Once done, stay done
		// unless the position genuinely moves away from the end (a real rewind).
		const wasDoneAtEnd =
			prev && prev.finished && v.currentTime >= seekEnd(v) - FINISH_TOL;
		// A finished video pins its position to the full duration even though
		// the seek barely landed under it: otherwise the panel/launcher keeps
		// showing the clamped landing spot (2:33:18 of 2:33:20) and the
		// load-time re-derivation in `init` would un-finish it.
		const finished = atEnd || wasDoneAtEnd;
		const pos = finished ? v.duration : v.currentTime;
		const changed =
			!prev ||
			Math.abs((prev.position || 0) - pos) > 0.5 ||
			prev.duration !== v.duration ||
			prev.finished !== finished;
		cache[id] = {
			title: m.title,
			channel: m.channel,
			position: pos,
			duration: v.duration,
			finished: finished,
			updatedAt: new Date().toISOString(),
		};
		dirty.add(id);
		saveCache();
		saveDirty();
		if (changed)
			log(
				`record v=${id} p=${Math.round(pos)} d=${Math.round(v.duration)} fin=${finished} why=${why || "?"}${prev ? ` (was p=${Math.round(prev.position)} fin=${prev.finished})` : ""}`
			);
		schedulePush();
	}

	function bind() {
		const v = document.querySelector("video");
		if (!v || v === bound) return;
		bound = v;
		v.addEventListener("timeupdate", () => record(false, "tick"));
		v.addEventListener("pause", () => {
			record(true, "pause");
			flush();
		});
		// Seeked-to-the-end must still be marked finished: after the video
		// actually ends, currentTime sits at duration and the `ended` event is
		// the reliable signal. timeupdate can fire early (throttled, slightly
		// under duration) and pause never fires when autoplay loads the next
		// video into the same element.
		v.addEventListener("ended", () => {
			record(true, "ended");
			flush();
		});
		// Seeking straight to the end never fires `ended` (it only fires while
		// playing), and the player clamps the seek a hair under duration - so
		// a drag-to-the-end used to sit there unfinished forever. Catch the
		// seeked landing instead and count it as finished.
		v.addEventListener("seeked", () => {
			if (v.currentTime >= seekEnd(v) - FINISH_TOL) {
				record(true, "seeked");
				flush();
			}
		});
	}

	// The ended-mode clock is the source of truth, but there is no event for
	// "user sat on the end screen for a minute" - seeked fired once already
	// and nothing re-writes after that. Poll gently while a player exists
	// and re-record if the player itself reports the video as finished. The
	// cheap cache comparison stops redundant writes once it's already done.
	let lastEndMark = null;
	setInterval(() => {
		const id = videoId();
		if (!bound || !id || !playerEnded()) return;
		const e = cache[id];
		if (e && e.finished && lastEndMark === id) return;
		if (e && e.duration && Math.abs(e.duration - (bound.duration || e.duration)) > 1) return;
		lastEndMark = id;
		record(true, "poller");
		flush();
	}, 2000);

	document.addEventListener("yt-navigate-finish", () => {
		bound = null;
		setTimeout(bind, 800);
	});
	window.addEventListener("beforeunload", () => {
		record(true, "unload");
		flush();
	});
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
		record(true, "pagehide");
		// The tab is going away; the debounced push may never fire, so push the
		// final position now instead of waiting for the next tick/visit.
		flush();
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
/* Timestamps like "1:04:12" need more room than the logo, so bump the size and
   tighten tracking to keep it inside the 44px circle. */
#ytp-btn.ytp-time{font:600 13px/1 system-ui;letter-spacing:-.3px}
/* Fullscreen playback: get the launcher and panel out of the way. YouTube may
   request fullscreen on the player or on a page container, so match any
   fullscreen descendant rather than assuming which element it is. */
html.ytp-fs #ytp-btn,html.ytp-fs #ytp-panel{display:none!important}
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
#ytp-log{max-height:280px;overflow:auto;font:10px/1.5 ui-monospace,Consolas,monospace;color:#9ec;white-space:pre-wrap;word-break:break-all;margin-top:6px;background:#0008;padding:6px;border-radius:4px}
#ytp-log .t{color:#667;margin-right:6px}
#ytp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#555;transition:background .2s}
#ytp-dot.busy{background:#3ea6ff;animation:ytp-spin .8s linear infinite}
#ytp-dot.ok{background:#2ecc71}
#ytp-dot.fail{background:#e74c3c}
@keyframes ytp-spin{0%{opacity:.25}50%{opacity:1}100%{opacity:.25}}
.ytp-thumb-bar{position:absolute;left:0;right:0;bottom:8px;height:4px;background:#0009;z-index:10;pointer-events:none}
.ytp-thumb-bar i{display:block;height:100%;background:#0f0;transition:width .2s}
.ytp-thumb-bar.done i{background:#0ff}
ytd-thumbnail:hover .ytp-thumb-bar,
ytd-video-renderer:hover .ytp-thumb-bar,
ytd-rich-grid-media:hover .ytp-thumb-bar,
yt-lockup-view-model:hover .ytp-thumb-bar,
a:hover > .ytp-thumb-bar,
#thumbnail:hover .ytp-thumb-bar,
yt-image:hover .ytp-thumb-bar{display:block!important;opacity:1!important;visibility:visible!important;z-index:10000!important}`;

	const style = document.createElement("style");
	style.textContent = css;
	document.head.appendChild(style);

	const btn = document.createElement("button");
	btn.id = "ytp-btn";
	btn.textContent = "YT\u25B6";
	btn.title = "Watch progress";

	// On a watch page the launcher is more useful as a readout of the position we
	// last saved for this video than as a static logo. Everywhere else there is no
	// single video to report on, so fall back to the logo.
	const BTN_LOGO = "YT\u25B6";
	function syncBtnLabel() {
		const id = location.pathname === "/watch" ? idFromHref(location.href) : null;
		const e = id ? cache[id] : null;
		// Below a second there is nothing meaningful saved yet, and "0:00" would read
		// as a broken label rather than an empty one.
		if (e && e.position >= 1) {
			btn.textContent = fmt(e.position);
			btn.classList.add("ytp-time");
			btn.title = e.duration
				? `Saved at ${fmt(e.position)} / ${fmt(e.duration)}`
				: `Saved at ${fmt(e.position)}`;
		} else {
			btn.textContent = BTN_LOGO;
			btn.classList.remove("ytp-time");
			btn.title = "Watch progress";
		}
	}
	// Polling rather than hooking every writer: record() is throttled, pull() and
	// the SPA router both mutate state on their own schedules, and a one second
	// refresh keeps the label correct without threading calls through all of them.
	setInterval(syncBtnLabel, 1000);
	document.addEventListener("yt-navigate-finish", syncBtnLabel);
	syncBtnLabel();

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
			el("button", { "data-t": "log", text: "Log" }),
			el("button", { "data-t": "set", text: "Settings" })
		),
		el("div", { class: "ytp-body on", "data-b": "list" }),
		el(
			"div",
			{ class: "ytp-body", "data-b": "log" },
			el(
				"div",
				{ class: "ytp-act" },
				el("button", { "data-a": "clearlog", text: "Clear log" })
			),
			el("div", { id: "ytp-log" })
		),
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

	// Hide the launcher and panel during fullscreen playback. A pure-CSS
	// :fullscreen / :has() rule did not hold up here, so drive it from the
	// fullscreenchange event and flag the root element instead. Checking both the
	// standard and webkit properties covers YouTube's older fullscreen path.
	function syncFullscreen() {
		const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
		document.documentElement.classList.toggle("ytp-fs", fs);
		// Collapse the panel on the way in so it is not left open behind the video.
		if (fs) panel.classList.remove("open");
	}
	document.addEventListener("fullscreenchange", syncFullscreen);
	document.addEventListener("webkitfullscreenchange", syncFullscreen);
	syncFullscreen();

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
			if (b.dataset.t === "log") renderLog();
		};
	});

	function renderLog() {
		const box = panel.querySelector("#ytp-log");
		if (!box) return;
		box.replaceChildren(
			...[...logBuf].reverse().slice(0, 400).map((l) =>
				el(
					"div",
					{},
					el("span", { class: "t", text: new Date(l.t).toLocaleTimeString() }),
					el("span", { text: l.msg })
				)
			)
		);
	}

	panel.querySelector('[data-a="clearlog"]').onclick = () => {
		logBuf = [];
		GM_setValue(K_LOG, "[]");
		renderLog();
		status("log cleared");
	};

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

	// updatedAt reaches the cache in two shapes: record() writes a UTC ISO string
	// ending in Z, while Neon returns "2026-08-04 09:12:33.123456" with no zone.
	// new Date() reads that naive form as local time, so pulled rows were skewed by
	// the local UTC offset and interleaved wrongly with locally recorded ones.
	// Normalize to epoch ms, treating a missing zone as UTC, and treat unparseable
	// values as oldest rather than NaN (NaN comparisons leave order untouched,
	// which is what pinned stale rows at the top).
	function ts(v) {
		if (!v) return 0;
		if (typeof v === "number") return v;
		let s = String(v).trim();
		if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s = s.replace(" ", "T") + "Z";
		const n = Date.parse(s);
		return Number.isFinite(n) ? n : 0;
	}

	// Short "how long ago" label for the list rows. Showing the sort key makes the
	// ordering verifiable at a glance instead of having to trust it.
	function ago(ms) {
		if (!ms) return "";
		const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
		if (s < 60) return "just now";
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	function renderList() {
		const body = panel.querySelector('[data-b="list"]');
		// Most recently played first.
		const rows = Object.entries(cache).sort(
			(a, b) => ts(b[1].updatedAt) - ts(a[1].updatedAt)
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
			// Finished entries report 100%: their stored position can sit a
			// fraction under duration (the seek clamp), which would floor to
			// 99% while the row is already marked done.
			const pct = e.finished ? 100 : Math.min(100, Math.floor((e.position / e.duration) * 100)) || 0;
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
						el("span", {
						text: [e.channel || "", ago(ts(e.updatedAt))].filter(Boolean).join(" - "),
					}),
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

	function retime(a, id, e) {
		const secs = Math.round(e.position);
		// Our timestamp must win over YouTube's own resume link. A t= exactly at
		// the very end drops you on the end card, so cap it 2s short of duration
		// instead of removing our stamp: since ended videos now record position ==
		// duration, skipping left links wearing YouTube's official timestamp again.
		// Keying this off `finished` instead of the actual position was also wrong:
		// `finished` is sticky and never clears, so once a video was completed its
		// link stayed plain forever - even after rewinding to the middle.
		const dur = e.duration || 0;
		if (secs < 1 || !(dur > 0)) return;
		const t = Math.min(secs, Math.max(1, dur - 2));
		if (a.dataset.ytpT === String(t)) return;
		try {
			const u = new URL(a.getAttribute("href"), location.origin);
			u.searchParams.set("t", `${t}s`);
			a.setAttribute("href", u.pathname + u.search);
			a.dataset.ytpT = String(t);
		} catch {}
	}

	// YouTube's SPA router never reads the href we rewrote. Clicking a thumbnail
	// fires an internal navigation endpoint that carries YouTube's own resume
	// timestamp, so our t= is dropped and the player jumps to their tracked
	// position instead. Stash the position we want on click, then seek once the
	// player for that exact video is actually ready.
	const K_SEEK = "pendingSeek";
	const SEEK_TTL_MS = 30000;

	function takeSeek() {
		let p = null;
		try {
			p = JSON.parse(GM_getValue(K_SEEK, "null"));
		} catch {}
		if (!p || !p.id) return null;
		// Only honour a very recent click, otherwise a stale value could hijack a
		// later navigation the user made some other way.
		if (Date.now() - (p.at || 0) > SEEK_TTL_MS) {
			GM_setValue(K_SEEK, "null");
			return null;
		}
		return p;
	}

	function applySeek(tries) {
		tries = tries || 0;
		const p = takeSeek();
		if (!p) return;
		const retry = () => {
			if (tries < 24) setTimeout(() => applySeek(tries + 1), 250);
		};
		// Wait for the URL to settle on the clicked video before touching anything.
		if (idFromHref(location.href) !== p.id) return retry();
		const v = document.querySelector("video");
		if (!v || !Number.isFinite(v.duration) || !v.duration) return retry();
		if (Math.abs(v.currentTime - p.secs) > 2) {
			const before = v.currentTime;
			v.currentTime = p.secs;
			log(`seek applied v=${p.id} -> ${Math.round(p.secs)}s (was ${Math.round(before)}s)`);
			// YouTube applies its own resume slightly after the player becomes ready,
			// so verify the seek actually stuck rather than assuming one write wins.
			if (tries < 24) setTimeout(() => applySeek(tries + 1), 400);
			return;
		}
		GM_setValue(K_SEEK, "null");
	}

	// Capture phase, because YouTube's own handlers stop propagation.
	document.addEventListener(
		"click",
		(ev) => {
			// Thumbnails live inside web components, so walk the composed path instead
			// of relying on closest() from the retargeted event target.
			const path = ev.composedPath ? ev.composedPath() : [];
			const a =
				path.find(
					(n) =>
						n &&
						n.tagName === "A" &&
						(n.getAttribute?.("href") || "").includes("/watch?v="),
				) || ev.target?.closest?.("a[href*='/watch?v=']");
			if (!a) return;
			const href = a.getAttribute("href") || "";
			const id = idFromHref(href);
			if (!id) return;
			const secs = Number(a.dataset.ytpT);
			if (Number.isFinite(secs)) {
				GM_setValue(K_SEEK, JSON.stringify({ id, secs, at: Date.now() }));
			}
			// Let the browser handle modified clicks (new tab, new window, download)
			// normally - those already do a real load and honour the href's t=.
			if (
				ev.button !== 0 ||
				ev.ctrlKey ||
				ev.metaKey ||
				ev.shiftKey ||
				ev.altKey ||
				ev.defaultPrevented
			) {
				return;
			}
			// Seeking after the SPA navigation was not enough: YouTube owns the player
			// and reapplies its own resume position. Cancel its routing entirely and do
			// a real navigation to our href, which the watch page parses on load.
			// stopImmediatePropagation is required because YouTube's delegated click
			// handler is also on document and would otherwise still route.
			ev.preventDefault();
			ev.stopImmediatePropagation();
			location.assign(href);
		},
		true,
	);

	document.addEventListener("yt-navigate-finish", () => setTimeout(applySeek, 300));
	if (location.pathname === "/watch") setTimeout(applySeek, 800);

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
		// A finished entry must still paint a full bar even if position/duration are
		// missing or were flattened to 0 by older clobbering writes.
		if (!e || (!e.duration && !e.finished)) {
			if (bar) bar.remove();
			return;
		}
		// Show the real position even on a finished video. Forcing 100% here meant a
		// rewound video kept painting a full bar and hid where you actually left off.
		// `finished` is only the fallback for entries with no usable duration.
		// A finished entry stored at duration - FINISH_TOL (the seekable clamp)
		// floors to 99%, but it IS done - so let the cyan state own the full bar.
		const rawPct = Math.floor((e.position / e.duration) * 100);
		const pct = e.finished
			? 100
			: Number.isFinite(rawPct)
				? Math.min(100, Math.max(0, rawPct))
				: 0;
		if (!bar) {
			bar = el("div", { class: "ytp-thumb-bar" }, el("i"));
			box.append(bar);
		}
		bar.classList.toggle("done", !!e.finished);
		bar.firstChild.style.width = `${pct}%`;
		bar.title = `${fmt(e.position)} / ${fmt(e.duration)} - ${pct}% (${Math.round(e.position)}s)`;
		retime(a, id, e);
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
