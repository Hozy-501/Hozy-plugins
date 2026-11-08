# Hozy's Image OCR

A Valenced plugin for Discord (Android) that extracts text from any image attachment with one long-press tap and shows the result only to you as a local message — no one else in the chat sees it.

> **Goal:** read text from screenshots, memes, and photos without zooming or typing — useful for Arabic / English screenshots.

---

## Features

- **Long-press to extract** — hold any image message, then hit *Extract Text* in the action sheet
- **40+ OCR languages** — searchable picker (Arabic, English, French, German, Spanish, Japanese, Chinese, and more); **All** covers mixed Arabic + English
- **Two providers** — **OCR.space** (free, works without a key) or **Google Gemini vision** (needs a free key from AI Studio, better with handwriting + noisy photos)
- **Works out of the box** — OCR.space uses the free demo key; paste your own key in Settings for higher limits
- **Local-only output** — the text appears as a local message visible only to you, plus a Copy popup
- **Cache (100 max)** — re-pressing *Extract Text* on the same image loads instantly from device storage
- **Works with Hozy's Translator** — translate the extracted text to Arabic in one more tap
- **Clean teardown** — all patches removed when the plugin is disabled, no memory leaks

---

## Installation

1. Open Discord and go to **Settings → Valenced → Plugins**
2. Tap the gear icon in the top-right corner
3. Paste the repository URL and tap **Add repository**
4. Go back to the Plugins page and tap **[+]**
5. Find **Hozy's Image OCR** and install it

> Tip: also install **Hozy's Translator** (`com.hozy.translator`) so you can translate extracted text anytime.

---

## How to use

1. Long-press any image / screenshot message
2. Tap **Extract Text**
3. The text appears right in the chat — only you can see it, plus a popup with **Copy**
4. (Optional) Long-press the result → **Translate** (from Hozy's Translator) → choose Arabic

---

## Settings

Go to **Settings → Valenced → Plugins → Hozy's Image OCR → Settings**

| Option | Description |
|---|---|
| OCR Provider | **OCR.space** (free, no key needed) or **Gemini vision** (better handwriting) |
| OCR Language | **All** (Arabic + English, recommended) or any of 40+ languages via searchable picker |
| API Key | Leave empty for OCR.space demo key. For Gemini: free key from `aistudio.google.com` |
| Gemini Model | Leave empty for the default (`gemini-2.0-flash`). Override in Settings |
| Show transcript popup | Toggle the **Extracted Text + Copy** popup on/off |

### Gemini (optional)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- Yes, Gemini supports image OCR — it reads Arabic dialect, handwriting, and noisy backgrounds better than OCR.space.
- Free tier: Google AI Studio (no credit card) → **Get API key** → paste it → set **Provider = Gemini**.

### Notes on OCR.space
- Free demo key (`helloworld`): ~25k requests/day, up to ~1 MB per image, Engine 2.
- Your own key (free at `https://ocr.space/ocrapi/freekey`): higher limits.
- Very large images are downscaled by OCR.space automatically.

---

## Author

- **Developer:** HsHs-501
- **Discord:** `.95.4`
- **Discord Server:** [Join](https://discord.gg/jwpb9YdBJa)

---

*Built for the Valenced community. Local-only: the image is fetched for OCR, but the result never leaves your device as a normal chat message.*
