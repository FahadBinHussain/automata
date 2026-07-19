# Spotify/SoundCloud to YouTube Search & History Sync

A Violentmonkey/Tampermonkey userscript that adds a YouTube search button to every song on Spotify and SoundCloud. It syncs your clicked history to a private Google Sheet so your history is shared across all your computers.

## Setup Instructions

### 1. Set up the Database (Google Sheets)
1. Create a new [Google Sheet](https://sheets.google.com).
2. Go to **Extensions > Apps Script**.
3. Paste the code from `google-apps-script.js`.
4. Click **Deploy > New Deployment**.
5. Select **Web App**, Execute as: **Me**, Who has access: **Anyone**.
6. Copy the Web App URL (`https://script.google.com/macros/s/.../exec`).

### 2. Install the Script
1. Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey.
2. Create a new script and paste the code from `spotify-soundcloud-track-history-tracker-and-smart-youtube-search-integration.js`.
3. Paste your Web App URL into the `CLOUD_URL` variable at the top of the script (replace the `"YOUR_URL_HERE"` placeholder).
   - If you leave the placeholder in place, a red banner will appear at the top of every Spotify/SoundCloud page warning you cloud sync is offline. Clicks open YouTube but do NOT mark the track visited.
4. Save and refresh Spotify or SoundCloud.

### Cloud sync health banner
The script does NOT silently fall back to local-only state. If cloud history fetch or save fails (network error, auth wall, HTTP non-2xx, malformed JSON, etc.), a red banner is shown at the top of the page explaining why, and the icon will not turn red on click. The script retries history fetch on an exponential backoff (15s → 120s, up to 5 attempts) to self-heal transient outages.

The Apps Script stores history in the same spreadsheet with separate tabs: `Spotify` and `SoundCloud`. Existing old Spotify rows are preserved by reusing/renaming the old active tab as `Spotify` the first time the updated backend runs. If SoundCloud rows were accidentally saved in the old sheet before the backend was updated, the backend moves rows whose IDs start with `soundcloud:` into the `SoundCloud` tab on the next SoundCloud sync.
