# Hozy's Ghost Messages

A Valenced plugin for Discord (Android) that saves **edited** and **deleted** messages locally — even after you restart the app. Nothing leaves your device.

> **Idea:** someone edits or deletes a message you needed → you still have the original here.

---

## Features

- **Ghost log (200 events)** — every edit (`old → new`) and delete is saved on your device (`ghosts.json`)
- **Archive by person** — grouped by author (nickname + `@username`), tap a person to open their archive
- **Search + multi-filters** — search by username/nickname/text, filter by Edits / Deletes / Media / Voice / Links / Favorites (multiple at once)
- **Media + voice + links** — entries remember attachments, 🎤 voice flags, and 🔗 links (links may expire like CDN)
- **Favorites (⭐)** — star any ghost, then filter only ⭐ across everyone
- **Survives restarts** — stored via Valenced JSON storage, not in-memory
- **Recent cache (500 messages)** — remembers each message's last content so deletes/edits can be logged
- **Optional toasts** — quick `🗑 Deleted by …` / `✏️ Edited by …` alerts
- **Light & local** — no server, no uploads; clean teardown on disable

---

## How it works

The plugin patches Discord's **Dispatcher** and watches three event types:

| Event | What we do |
|---|---|
| `MESSAGE_CREATE` | Save the message (id → content/author) to the recent cache |
| `MESSAGE_UPDATE` | Log `old content → new content` to the ghost log |
| `MESSAGE_DELETE` / `MESSAGE_DELETE_BULK` | Log the last known content to the ghost log |

---

## Installation

1. Open Discord and go to **Settings → Valenced → Plugins**
2. Tap the gear icon in the top-right corner
3. Paste the repository URL and tap **Add repository**
4. Go back to the Plugins page and tap **[+]**
5. Find **Hozy's Ghost Messages** and install it

---

## Settings

Go to **Settings → Valenced → Plugins → Hozy's Ghost Messages → Settings**

| Option | Description |
|---|---|
| Notify on delete / Notify on edit | Toggle the toast alerts on/off |
| Archive — by person | Expand a person to see their edits/deletes with date, media, voice, links |
| Search | By username, nickname, or text |
| Filters (multi-select) | Edits / Deletes / Media / Voice / Links / Favorites |
| ⭐ Favorite | Star any ghost; filter ⭐ to see only favorites |
| Clear ghost log | Removes the saved events (keeps tracking) |
| Clear everything | Removes log + message cache |

---

## Author

- **Developer:** HsHs-501
- **Discord:** `.95.4`
- **Discord Server:** [Join](https://discord.gg/jwpb9YdBJa)

---

*Built for the Valenced community. Local-only: ghosts are stored on this device — they are never posted to any chat.*
