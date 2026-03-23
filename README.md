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


| Permission         | Why                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `storage`          | Sessions, settings, streak, insights.                                                          |
| `tabs`             | Open Google Form tab, query active tab for popup status.                                       |
| `scripting`        | Inject `form-filler.js` on the Google Form page.                                               |
| `activeTab`        | Works with the current tab where relevant.                                                     |
| `alarms`           | Reserved for future scheduled tasks.                                                           |
| `host_permissions` | `https://*/*`, `http://*/*` — content script on video pages; Groq API from the service worker. |


## Settings (Options)

Open the extension popup → **gear** (or right-click the icon → **Options**).

- **Groq API key** (`lt_groq_key`): Required for AI enrichment and insights. Get a key from [Groq Console](https://console.groq.com/).
- **Model** (`lt_model`): Defaults to a Llama 3.3 variant in code; see `utils/groq.js`.
- **Google Form URL** (`lt_form_url`): Must be a `docs.google.com/forms` URL used for sync.
- **Auto-submit** (`lt_auto_submit`): Whether the form filler should submit automatically after filling.

**Runtime source of truth:** The extension always reads **Form URL, model, and auto-submit** from `chrome.storage.local` (fast, persistent). It does **not** read `defaults.json` on every click — that file is used to **seed** empty keys and to **re-apply** when you use **Apply from defaults.json** in Options.

### Bundled defaults (`config/defaults.json`)

- Put your shared **Google Form URL**, **Groq model id**, and **auto-submit** flag in `**config/defaults.json`** (see `config/defaults.example.json`).
- On extension **startup**, the service worker copies values from that file into storage **only for keys that are still empty** (first install or cleared fields).
- After you edit the file, either **Reload** the extension (see below) and rely on empty-key seeding, or open Options → **Apply from defaults.json** to **overwrite** Form URL / model / auto-submit from the file.
- **Do not** commit real **Groq API keys** in JSON; keep the key in Options (storage only). If you need a local-only override file, keep secrets out of git.

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


| Issue                                               | What to check                                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing is captured on YouTube                      | Reload the watch page after updating the extension. Ensure the video is actually playing (not only the tab open). **Pause** or **leave the tab** after 30+ seconds of play to finalize a session.     |
| Popup shows “Play any video…” while a video is open | You should see a **completed** session only after a pause/navigation. If stats stay at zero after that, open DevTools → Console on the YouTube page and look for `[LT]` logs from the content script. |
| Groq / insights                                     | Add a valid API key in Options. Without a key, enrichment is skipped; sync still needs enriched sessions for the default unsynced filter.                                                             |
| Form sync doesn’t run                               | Set a valid Google Form URL. Ensure sessions appear as **enriched** (purple dot) before they count as unsynced for sync.                                                                              |


## Development: reload vs reinstall

Chrome **does not** auto-reload unpacked extensions when files change. After you edit code:

1. Open `chrome://extensions`.
2. Click **Reload** on **Learning Tracker** (circular arrow on the card).

**You do not need to “Load unpacked” again** for every change — only **Reload**. `**chrome.storage.local` is kept** when you Reload, so Form URL, Groq key, and sessions usually stay (same extension folder / same development profile).

**When settings reset:** Removing the extension from Chrome (**Remove**) clears its storage. Loading unpacked again is a fresh install — then seed from `config/defaults.json` or enter Options again.

### Automated tests (recommended)

From the repo root (requires [Node.js](https://nodejs.org/)):

```bash
npm install
npm test
```

This runs **Node’s built-in test runner** on:

- `**test/video-discovery.test.mjs`** — Shadow DOM traversal and primary video selection (uses [happy-dom](https://github.com/capricorn86/happy-dom)).
- `**test/defaults.test.mjs**` — `seedBundledDefaultsIfEmpty` with mocked `chrome.storage` and `fetch`.

These checks verify core logic without opening Chrome. After code changes, run `npm test` before reloading the unpacked extension.

### Watch helper (optional)

```bash
npm install
npm run dev
```

This watches extension sources and prints a reminder to Reload in `chrome://extensions`. It does **not** reload Chrome for you; that would require extra tooling or a separate “extension reloader” extension.

## Development notes

- **Manifest**: MV3, `manifest.json` at repo root.
- **Icons**: `icons/icon16.png` … `icon128.png`.
- **Clear data**: Options page can clear `lt_sessions`, `lt_streak`, `lt_insights`, `lt_pending_form` (not Form URL / key unless you clear storage manually).

## Files


| Path                                  | Role                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `manifest.json`                       | MV3 manifest, content scripts, background, options, popup.                          |
| `config/defaults.json`                | Bundled defaults (Form URL, model, auto-submit); seeds storage when empty.          |
| `config/defaults.example.json`        | Example defaults.                                                                   |
| `content/video-tracker.js`            | Video detection, session lifecycle, messages.                                       |
| `content/form-filler.js`              | Injected on Google Forms to fill fields.                                            |
| `background/service-worker.js`        | Sessions, Groq, sync, badge.                                                        |
| `popup/popup.html` / `popup.js`       | UI.                                                                                 |
| `options/options.html` / `options.js` | Settings.                                                                           |
| `utils/storage.js`                    | `chrome.storage.local` helpers.                                                     |
| `utils/video-discovery.js`            | Shadow DOM video scan + primary player selection (loads before `video-tracker.js`). |
| `utils/defaults.js`                   | Load / seed `config/defaults.json`.                                                 |
| `utils/groq.js`                       | Groq API calls.                                                                     |
| `test/*.test.mjs`                     | `npm test` — video discovery + defaults seeding.                                    |
| `scripts/dev-reload-hint.js`          | Printed when `npm run dev` detects file changes.                                    |


## License

Use and modify for your own learning workflow. Add a license file if you redistribute.