# Hozy's Chatbot

A Valenced plugin for Discord (Android) that answers your questions with one `/ask` command inside any chat — **local-only** (only you see it), **normal markdown messages** (*italic*, **bold**, `code`, ```blocks```), no embeds.

> **Role:** a programming assistant by default (explain errors, fix code, write snippets) — you can change the system prompt in Settings.

---

## Features

- **`/ask <question>`** — type it in any chat; your question is **not** sent to the server
- **Any model** — Groq (free), Google Gemini (free via AI Studio), OpenAI, or any OpenAI-compatible endpoint
- **Reads links** — URLs in your question are fetched (first ~4000 chars) and passed as context
- **Reads images** — paste an image URL in your question; the model sees it (Gemini / vision models)
- **Discord markdown** — answers come back as a **normal local message** so *text* / **text** / `code` render natively
- **Lightweight** — single-shot, no history stored, clean teardown

---

## Installation

1. Open Discord and go to **Settings → Valenced → Plugins**
2. Tap the gear icon in the top-right corner
3. Paste the repository URL and tap **Add repository**
4. Go back to the Plugins page and tap **[+]**
5. Find **Hozy's Chatbot** and install it

---

## How to use

1. In any chat, type:
   ```
   /ask explain this error in one line: TypeError: x is undefined
   /ask write a JS function that debounce()s a search input
   /ask what does this page say? https://example.com
   /ask describe this image https://example.com/photo.png
   ```
2. The answer appears right in the chat — **only you can see it**.

---

## Settings

Go to **Settings → Valenced → Plugins → Hozy's Chatbot → Settings**

| Option | Description |
|---|---|
| AI Provider | **Groq** (free, recommended), **Gemini** (free via AI Studio, best with images), **OpenAI**, **Custom** OpenAI-compatible |
| API Key | Stored locally only. Groq: `console.groq.com`. Gemini: `aistudio.google.com` |
| Model | Leave empty for the default (`llama-3.3-70b-versatile` / `gemini-2.0-flash` / `gpt-4o-mini`) or type any model name |
| Custom Endpoint | Only if you pick **Custom** — full chat completions URL |
| System Prompt | Defines the role (default: programming assistant with Discord markdown). Rewrite it for any role |

### Keys (free tiers)
- **Groq**: `https://console.groq.com` → **API Keys** → Create (no credit card)
- **Gemini**: `https://aistudio.google.com` → **Get API key** (no credit card)

---

## Author

- **Developer:** HsHs-501
- **Discord:** `.95.4`
- **Discord Server:** [Join](https://discord.gg/jwpb9YdBJa)

---

*Built for the Valenced community. Local-only: your question and the answer never leave this device as a normal chat message.*
