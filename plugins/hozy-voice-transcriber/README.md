# Hozy's Voice Transcriber

A Valenced plugin for Discord (Android) that transcribes voice messages to text in the spoken language and shows the result only to you as a local message — no one else in the chat sees it.

> **Goal:** made for when you don't understand English — long-press a voice message, get the transcript instantly, then (if you want) use **Hozy's Translator** on the transcript to read it in Arabic.

---

## Features

- **Long-press to transcribe** — hold any voice message, then hit *Transcribe* in the action sheet
- **Any language** — Whisper auto-detects the spoken language and transcribes in that language
- **Local-only output** — the transcript appears as a local message visible only to you
- **No-key first** — tries HuggingFace Whisper without a key; if it's rate-limited, add a free Groq key once
- **Transcript cache (100 max)** — re-pressing *Transcribe* on the same voice message loads instantly from device storage instead of calling Whisper again, saving your free quota. Clear it from Settings anytime.
- **Copy button** — every transcription opens a popup with the full text + **Copy / نسخ** button (copies via Discord clipboard), on top of the chat message
- **Searchable language picker** — pick the language hint from a searchable list (80+ languages) instead of typing a code
- **Arabic error messages** — toasts explain failures in Arabic (e.g. invalid key, free service busy, download failed) and tell you what to do
- **Works with Hozy's Translator** — because the transcript is a local message from a different author, the **Translate** action (same icon as the translator) appears on it. Install both plugins and you can translate the transcript to Arabic in one more tap.
- **Clean teardown** — all patches removed when the plugin is disabled, no memory leaks

---

## Installation

1. Open Discord and go to **Settings → Valenced → Plugins**
2. Tap the gear icon in the top-right corner
3. Paste the repository URL and tap **Add repository**
4. Go back to the Plugins page and tap **[+]**
5. Find **Hozy's Voice Transcriber** and install it

> Tip: also install **Hozy's Translator** (`com.hozy.translator`) so you can translate transcripts straight to Arabic.

---

## How to use

1. Long-press any voice / audio message
2. Tap **Transcribe**
3. The transcript appears right in the chat — only you can see it, plus a popup with **Copy / نسخ**
4. (Optional) Long-press the transcript → **Translate** (from Hozy's Translator) → choose Arabic
5. Re-press **Transcribe** on the same message → loads from cache instantly (no new API call)

---

## Settings

Go to **Settings → Valenced → Plugins → Hozy's Voice Transcriber → Settings**

| Option | Description |
|---|---|
| Transcription Provider | **Auto — no key** (default, tries HuggingFace free), **Groq** (recommended free, fastest), **HuggingFace**, **OpenAI**, **Custom endpoint** |
| API Key | Paste your key here (stored locally on your device only) |
| Custom Endpoint | Only if you pick *Custom endpoint* |
| Model | Optional override (e.g. `whisper-large-v3-turbo` for Groq). Leave empty for defaults |
| Language hint | `auto` = detect automatically. Set e.g. `en` or `ar` to force |

### Best free key (with the button? no — you need a key)

No fully-free, unlimited, keyless Whisper exists. The **best free option is Groq**:

1. Open https://console.groq.com — sign up (free, no credit card)
2. Go to **API Keys** → **Create API Key** → copy it (starts with `gsk_...`)
3. In the plugin Settings: **Provider = Groq**, paste the key in **API Key** — done

Groq's free tier runs `whisper-large-v3-turbo` — fast and very accurate, with generous daily limits for personal use.

**Alternatives:**
- **HuggingFace** (also free): https://huggingface.co/settings/tokens → create a *read* token → Provider = HuggingFace
- **OpenAI** (paid): https://platform.openai.com/api-keys → Provider = OpenAI

> If you stay on **Auto — no key**, the plugin will still try HuggingFace's free endpoint first. If it hits the daily/rate limit, you'll see a toast telling you to add a Groq key — that's expected.

---

## How it works (internals)

1. The plugin patches Discord's message action sheet / context menu (same technique as the Translator) and only shows **Transcribe** on messages that have an audio attachment / voice flag.
2. The audio URL is downloaded from the CDN, sent to a Whisper endpoint, and the returned text is rendered as a local ephemeral message (via `createBotMessage` / `receiveMessage`, same as the Translator).
3. Because the local message is authored as *Hozy's Voice Transcriber* (not *Hozy's Translator*), the Translator's **Translate** action is allowed on it — so translation works without any extra code.

---

## Author

- **Developer:** HsHs-501
- **Discord:** `.95.4`
- **Discord Server:** [Join](https://discord.gg/jwpb9YdBJa)

---

*Built for the Valenced community. Local-only: audio is fetched for transcription, but the result never leaves your device as a normal chat message.*
