# Learning Tracker (Chrome extension)

Track learning time on video sites (YouTube, Udemy, and generic HTML5 players), enrich sessions with **Groq** AI, and optionally sync structured answers to a **Google Form**.

## Features

- **Session capture**: Detects play/pause on HTML5 `<video>` elements, including players inside **Shadow DOM** (required for modern YouTube).
- **Multi-frame**: Content script runs in **all frames** (`all_frames: true`) so same-origin embedded players are still tracked.
- **Groq**: After each saved session, the session can be enriched (concept, domain, hours, etc.) and periodic insights are generated.
- **Google Forms sync**: Opens your form in a new tab and injects a filler script to map fields (see `content/form-filler.js`).

## Install (development)

1. Clone or copy this folder.
2. Open Chrome → **Extensions** → enable **Developer mode**.
3. **Load unpacked** → select the extension root (folder containing `manifest.json`).
4. Pin the extension if you want quick access to the popup.

## Permissions

| Permission        | Why |
|--------------------|-----|
| `storage`          | Sessions, settings, streak, insights. |
| `tabs`             | Open Google Form tab, query active tab for popup status. |
| `scripting`        | Inject `form-filler.js` on the Google Form page. |
| `activeTab`        | Works with the current tab where relevant. |
| `alarms`           | Reserved for future scheduled tasks. |
| `host_permissions` | `https://*/*`, `http://*/*` — content script on video pages; Groq API from the service worker. |

## Settings (Options)

Open the extension popup → **gear** (or right-click the icon → **Options**).

- **Groq API key** (`lt_groq_key`): Required for AI enrichment and insights. Get a key from [Groq Console](https://console.groq.com/).
- **Model** (`lt_model`): Defaults to a Llama 3.3 variant in code; see `utils/groq.js`.
- **Google Form URL** (`lt_form_url`): Must be a `docs.google.com/forms` URL used for sync.
- **Auto-submit** (`lt_auto_submit`): Whether the form filler should submit automatically after filling.

## How tracking works

1. **Detection**: A content script (`content/video-tracker.js`) polls roughly every **1.5s**. It walks the DOM **including Shadow DOM** to find `<video>` elements, because the YouTube player is not visible to `document.querySelectorAll('video')` alone.
2. **While playing**: When a video is playing (`!paused` and `readyState >= 2`), a **session** is started in memory and a `LT_PLAYING` message is sent to the background worker.
3. **When a session is saved**: When playback **stops** (pause, tab hidden, navigation, or closing the tab), accumulated time is finalized. A session is **saved to storage** only if total play time was **more than 30 seconds** (`durationMs > 30000`). Shorter segments are discarded.
4. **Important**: **Recent Sessions** in the popup lists **completed** sessions only. If you watch continuously without pausing, you may still see the empty state until you **pause**, **switch to another tab**, **navigate away**, or **close the tab** (after enough time has accumulated).

## Popup UI

- **HRS TODAY**: Sum of **completed** session durations that started **today** (local calendar day).
- **Sessions today**: Count of those sessions.
- **Day streak**: Updated when enrichment runs (see `utils/storage.js` bump logic).
- **Groq Analysis**: Insights after enough enriched sessions exist; **Refresh** requires a Groq key.
- **Sync**: Pushes **unsynced** sessions that are already **enriched** to your Google Form (see `getUnsyncedSessions` in `utils/storage.js`).

## Architecture (high level)

```
content/video-tracker.js  ──LT_SESSION_END──►  background/service-worker.js
        │                                                    │
        │                                                    ├── utils/storage.js
        └── LT_GET_STATUS ◄── popup/popup.js                   └── utils/groq.js
```

- **Service worker** (`background/service-worker.js`): ES module; imports `storage` and `groq`.
- **Popup** (`popup`): `LT_GET_DATA` loads sessions and stats; `chrome.tabs.sendMessage` asks the **active tab’s** content script for `LT_GET_STATUS` (playing state + title).

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Nothing is captured on YouTube | Reload the watch page after updating the extension. Ensure the video is actually playing (not only the tab open). **Pause** or **leave the tab** after 30+ seconds of play to finalize a session. |
| Popup shows “Play any video…” while a video is open | You should see a **completed** session only after a pause/navigation. If stats stay at zero after that, open DevTools → Console on the YouTube page and look for `[LT]` logs from the content script. |
| Groq / insights | Add a valid API key in Options. Without a key, enrichment is skipped; sync still needs enriched sessions for the default unsynced filter. |
| Form sync doesn’t run | Set a valid Google Form URL. Ensure sessions appear as **enriched** (purple dot) before they count as unsynced for sync. |

## Development notes

- **Manifest**: MV3, `manifest.json` at repo root.
- **Icons**: `icons/icon16.png` … `icon128.png`.
- **Clear data**: Options page can clear `lt_sessions`, `lt_streak`, `lt_insights`, `lt_pending_form`.

## Files

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest, content scripts, background, options, popup. |
| `content/video-tracker.js` | Video detection, session lifecycle, messages. |
| `content/form-filler.js` | Injected on Google Forms to fill fields. |
| `background/service-worker.js` | Sessions, Groq, sync, badge. |
| `popup/popup.html` / `popup.js` | UI. |
| `options/options.html` / `options.js` | Settings. |
| `utils/storage.js` | `chrome.storage.local` helpers. |
| `utils/groq.js` | Groq API calls. |

## License

Use and modify for your own learning workflow. Add a license file if you redistribute.
