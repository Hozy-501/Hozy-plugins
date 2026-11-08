export type LlmProvider = 'groq' | 'openai' | 'gemini' | 'custom'

export interface LlmSettings {
	provider: LlmProvider
	apiKey: string
	model: string
	customEndpoint: string
	systemPrompt: string
}

export interface LlmResult {
	text: string
	providerUsed: string
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
}

export function getProviderLabel(provider: LlmProvider): string {
	switch (provider) {
		case 'groq':
			return 'Groq (free, recommended)'
		case 'openai':
			return 'OpenAI'
		case 'gemini':
			return 'Google Gemini'
		default:
			return 'Custom OpenAI-compatible'
	}
}

function bytesToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ''
	const chunk = 0x8000
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
	}
	try {
		// @ts-ignore
		if (typeof btoa === 'function') return btoa(binary)
	} catch {}
	const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
	let out = ''
	for (let i = 0; i < binary.length; i += 3) {
		const c1 = binary.charCodeAt(i)
		const c2 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0
		const c3 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0
		out += base64[c1 >> 2]
		out += base64[((c1 & 3) << 4) | (c2 >> 4)]
		out += i + 1 < binary.length ? base64[((c2 & 15) << 2) | (c3 >> 6)] : '='
		out += i + 2 < binary.length ? base64[c3 & 63] : '='
	}
	return out
}

export function extractUrls(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? []
	return [...new Set(matches)].slice(0, 3)
}

function looksLikeImageUrl(url: string): boolean {
	return /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i.test(url.split('?')[0] ?? '')
}

export async function fetchUrlContext(urls: string[]): Promise<string> {
	const parts: string[] = []
	for (const url of urls) {
		if (looksLikeImageUrl(url)) continue
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0' },
			} as any)
			if (!res.ok) continue
			const text = await res.text()
			const snippet = text.slice(0, 4000)
			parts.push(`--- Source: ${url} ---\n${snippet}`)
		} catch {
			// skip unreachable links
		}
	}
	return parts.join('\n\n')
}

async function downloadImage(url: string): Promise<{ mime: string; data: ArrayBuffer } | null> {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
			},
		} as any)
		if (!res.ok) return null
		const data = await res.arrayBuffer()
		const mime =
			(res.headers.get('content-type') as string) || 'image/png'
		return { mime: mime.split(';')[0].trim() || 'image/png', data }
	} catch {
		return null
	}
}

export const DEFAULT_SYSTEM_PROMPT =
	"You are Hozy's Chatbot, a helpful programming assistant inside Discord. Answer concisely with Discord markdown: *italic*, **bold**, `inline code`, ```fenced code```, > quote, - list. Every answer is private to you. When given code or errors, explain briefly and show the fixed code. If asked about a URL, use the provided source context."

async function chatOpenAiCompatible(
	settings: LlmSettings,
	question: string,
	urlContext: string,
	imageBase64: string | null,
	imageMime: string | null,
): Promise<LlmResult> {
	const apiKey = (settings.apiKey || '').trim()
	if (!apiKey) throw new Error('API key is missing. Paste it in Settings.')
	const endpoint =
		settings.provider === 'groq'
			? 'https://api.groq.com/openai/v1/chat/completions'
			: settings.provider === 'openai'
				? 'https://api.openai.com/v1/chat/completions'
				: (settings.customEndpoint || '').trim()
	if (!endpoint) throw new Error('Custom endpoint URL is empty in Settings.')

	const model =
		(settings.model || '').trim() ||
		(settings.provider === 'groq'
			? 'llama-3.3-70b-versatile'
			: settings.provider === 'openai'
				? 'gpt-4o-mini'
				: 'gpt-4o-mini')

	const userText = urlContext
		? `${question}\n\n${urlContext}`
		: question

	const userContent: any =
		imageBase64 && imageMime
			? [
					{ type: 'text', text: userText },
					{
						type: 'image_url',
						image_url: { url: `data:${imageMime};base64,${imageBase64}` },
					},
				]
			: userText

	const body = {
		model,
		messages: [
			{ role: 'system', content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
			{ role: 'user', content: userContent },
		],
		temperature: 0.3,
		max_tokens: 2000,
		stream: false,
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	} as any)

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`Invalid or missing API key (${response.status}). Check Settings. ${bodyText.slice(0, 150)}`,
			)
		}
		throw new Error(
			`${getProviderLabel(settings.provider)} failed (${response.status}). ${bodyText.slice(0, 250)}`,
		)
	}

	const json: any = await response.json().catch(() => null)
	const text = firstString(
		json?.choices?.[0]?.message?.content,
		json?.choices?.[0]?.text,
	)
	if (!text) throw new Error('Model returned an empty answer.')
	return { text: text.trim(), providerUsed: getProviderLabel(settings.provider) }
}

async function chatGemini(
	settings: LlmSettings,
	question: string,
	urlContext: string,
	imageBase64: string | null,
	imageMime: string | null,
): Promise<LlmResult> {
	const apiKey = (settings.apiKey || '').trim()
	if (!apiKey) {
		throw new Error(
			'Gemini API key is missing. Get a free key from aistudio.google.com and paste it in Settings.',
		)
	}
	const model = (settings.model || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash'
	const userText = urlContext ? `${question}\n\n${urlContext}` : question

	const parts: any[] = [
		{ text: `${settings.systemPrompt || DEFAULT_SYSTEM_PROMPT}\n\n---\nUser: ${userText}` },
	]
	if (imageBase64 && imageMime) {
		parts.push({ inline_data: { mime_type: imageMime, data: imageBase64 } })
	}

	const body = {
		contents: [{ parts }],
		generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
	}
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	} as any)

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		if (response.status === 400 || response.status === 403) {
			throw new Error(
				`Gemini rejected the request (${response.status}). Check your API key. ${bodyText.slice(0, 150)}`,
			)
		}
		throw new Error(`Gemini failed (${response.status}). ${bodyText.slice(0, 250)}`)
	}

	const json: any = await response.json().catch(() => null)
	const cand = json?.candidates?.[0]
	const texts: string[] = []
	for (const part of cand?.content?.parts ?? []) {
		const t = firstString(part?.text)
		if (t) texts.push(t)
	}
	const text = texts.join('\n').trim()
	if (!text) throw new Error('Gemini returned an empty answer.')
	return { text, providerUsed: `Gemini (${model})` }
}

export async function askLlm(
	settings: LlmSettings,
	question: string,
): Promise<LlmResult> {
	const trimmed = question.trim()
	if (!trimmed) throw new Error('Nothing to ask.')

	const urls = extractUrls(trimmed)
	const urlContext = await fetchUrlContext(urls)

	let imageBase64: string | null = null
	let imageMime: string | null = null
	const imageUrl = urls.find(looksLikeImageUrl) ?? null
	if (imageUrl) {
		const downloaded = await downloadImage(imageUrl)
		if (downloaded) {
			imageBase64 = bytesToBase64(downloaded.data)
			imageMime = downloaded.mime
		}
	}

	if (settings.provider === 'gemini') {
		return chatGemini(settings, trimmed, urlContext, imageBase64, imageMime)
	}
	return chatOpenAiCompatible(settings, trimmed, urlContext, imageBase64, imageMime)
}
