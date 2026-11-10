# Hozy's Message Select

A Valenced plugin for Discord (Android) that lets you select multiple messages and delete them together — WhatsApp-style selection, without leaving the chat.

> **Idea:** stop deleting messages one by one. Long-press → **Select message**, pick the rest, then **Delete N selected**.

---

## Features

- **Multi-select messages** — select as many messages as you need (up to 100 per channel)
- **WhatsApp-style flow** — long-press a message, choose **Select message**, then long-press more messages to add them
- **One-tap batch delete** — choose **Delete N selected** from any message menu, confirm once, and the whole batch is removed
- **Clear selection** — remove the whole selection from the same menu
- **Safe confirmation** — shows a summary of the selected messages before deleting (can be disabled)
- **Rate-limit aware** — deletes one message at a time with a configurable delay and automatically waits if Discord returns `429`
- **Auto-cleanup** — deleted messages disappear from the selection automatically, even if someone else deletes them
- **Per-channel selection** — selections are kept separately for each channel
- **Local only** — selection lives in memory; nothing is uploaded or saved

---

## How to use

1. Long-press a message in any channel or DM.
2. Tap **Select message**.
3. Long-press another message and tap **Select message** again. Repeat for every message you want.
4. Long-press any message and tap **Delete N selected**.
5. Confirm the deletion.

To start over, tap **Clear selection** in the same menu.

---

## Settings

Go to **Settings → Valenced → Plugins → Hozy's Message Select → Settings**

| Option | Description |
|---|---|
| Confirm before deleting | Show a summary and ask before deleting the batch |
| Progress toast | Show `Deleting 2/10…` progress while the batch is running |
| Delay between deletions | 500 / 750 / 1000 / 1500 / 2000 ms — tap to change. Helps avoid rate limits |

---

## Notes

- Selection is **temporary**: it clears when Discord restarts or the plugin is disabled.
- You can only delete messages Discord allows you to delete (your own messages, or others' messages if you have **Manage Messages**).
- If Discord rate-limits a deletion, the plugin waits and retries once automatically.
- The plugin uses Discord's own delete API; it never asks for your token or sends anything to a third party.

---

## Installation

1. Open Discord and go to **Settings → Valenced → Plugins**
2. Tap the gear icon in the top-right corner
3. Paste the repository URL and tap **Add repository**
4. Go back to the Plugins page and tap **[+]**
5. Find **Hozy's Message Select** and install it

---

## Author

- **Developer:** HsHs-501
- **Discord:** `.95.4`
- **Discord Server:** [Join](https://discord.gg/jwpb9YdBJa)

---

*Built for the Valenced community. Local-only: selections never leave your device.*
