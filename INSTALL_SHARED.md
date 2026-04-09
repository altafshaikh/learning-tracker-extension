# Learning Tracker — Install from a ZIP (Chrome)

Use this guide to install the chrome extension using a **ZIP**. You load it as an **unpacked** extension (developer mode). Each person needs their **own Groq API key** (free tier is fine); keys are stored only in your browser.

---

## 1. Unzip the folder

1. Extract the ZIP anywhere you like (for example `Documents/LearningTracker`).
2. Open the extracted folder and confirm you see `**manifest.json`** at the **top level** of that folder (not one level deeper).
  - Chrome must point at the folder that **directly contains** `manifest.json`.

---

## 2. Install in Chrome

1. Open Chrome and go to `**chrome://extensions`** (paste into the address bar).
2. Turn **Developer mode** **ON** (toggle in the top-right).
3. Click **Load unpacked**.
4. Choose the folder that contains `**manifest.json`** (the extracted extension root).
5. Optional: click the **puzzle** icon → **pin** “Learning Tracker” for quick access.

---

## 3. Set up your Groq API key

Groq powers **session enrichment** (topics, domains, etc.) and **AI insights** in the popup. Without a key, the extension can still **track watch time**, but AI features stay off.

1. Get a free API key: [https://console.groq.com/](https://console.groq.com/) (sign in → create an API key). Keys usually start with `gsk_`.
2. Click the **Learning Tracker** icon in the toolbar.
3. Open **Settings** (gear icon), or right-click the extension icon → **Options**.
4. In **Groq API Key**, paste your key.
5. Optionally pick a **model** (the default in the list is fine for most users).
6. Click **Save** (or use the test control if your Options page offers “test key”).
7. Close Settings. After you finish a learning session (pause or leave the tab long enough), enrichment should run automatically.

**Privacy:** The key is stored in `**chrome.storage.local`** on your machine only. It is sent to **Groq’s API** when the extension runs AI features—not to the person who shared the ZIP.

**Do not** put your API key inside `config/defaults.json` if you share files with others; keep it in Settings only.

---

## 4. Optional: Looker studio Learning Tracker Google Form sync

After install, open **Settings** and confirm **Google Form URL** and other options. 

---

## 5. First use

1. Open a site with a video (e.g. YouTube) and **play** for more than ~30 seconds.
2. **Pause**, **Go back, on Window** closed session **ends** and is saved.
3. Open the extension popup — you should see the session. With Groq configured, it will show enriched details when processing finishes.

---

## Troubleshooting


| Problem                | What to try                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Load unpacked” fails  | Select the folder that **contains** `manifest.json`, not a parent or inner subfolder.                                                                                |
| No AI / insights       | Open Settings and confirm the Groq key is saved; key must be valid at [Groq Console](https://console.groq.com/).                                                     |
| Sessions not appearing | End the session (pause / leave tab) after **30+ seconds** of play; only completed sessions show in the list.                                                         |
| After a ZIP update     | Remove the old extension in `chrome://extensions`, then **Load unpacked** again on the new folder (or use **Reload** if you only replaced files in the same folder). |


---

## Packaging note (for whoever creates the ZIP)

From the extension root, a typical package includes:

`manifest.json`, `background/`, `content/`, `options/`, `popup/`, `utils/`, `icons/`, `config/`

Example (include this file so recipients see these steps):

```bash
zip -r learning-tracker-extension.zip manifest.json INSTALL_SHARED.md background content options popup utils icons config -x "*.DS_Store"
```

Do **not** rely on others to run `npm install` unless they are developing the extension; the shipped ZIP should be the full extension tree above.