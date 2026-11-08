export type OcrProvider = 'ocrspace' | 'gemini'
export type OcrLanguage = string

export interface OcrSettings {
	provider: OcrProvider
	apiKey: string
	language: OcrLanguage
	model: string
}

export interface OcrResult {
	text: string
	providerUsed: string
}

export interface ImageAttachment {
	url: string
	proxyUrl?: string
	filename: string
	contentType: string
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
}

export function getImageAttachment(message: any): ImageAttachment | null {
	if (!message || typeof message !== 'object') return null

	const candidates: any[] = []

	if (Array.isArray(message.attachments)) {
		candidates.push(...message.attachments)
	}
	if (Array.isArray(message.embeds)) {
		for (const embed of message.embeds) {
			if (embed?.image) candidates.push(embed.image)
			if (embed?.thumbnail) candidates.push(embed.thumbnail)
		}
	}
	if (message.attachment) candidates.push(message.attachment)
	if (Array.isArray(message.stickerItems)) {
		// stickers are already images, no download needed via attachments
	}

	for (const att of candidates) {
		if (!att || typeof att !== 'object') continue
		const url = firstString(att.url, att.src, att.href)
		const proxyUrl = firstString(att.proxy_url)
		const bestUrl = url ?? proxyUrl
		if (!bestUrl) continue
		const filename =
			firstString(att.filename, att.name, att.fileName) ?? 'image.png'
		const contentType =
			firstString(att.content_type, att.contentType, att.mimetype) ?? ''

		const isImageType = contentType.toLowerCase().startsWith('image/')
		const isImageExt = IMAGE_EXT.test(filename) || IMAGE_EXT.test(bestUrl.split('?')[0] ?? '')

		if (isImageType || isImageExt) {
			return {
				url: bestUrl,
				proxyUrl,
				filename,
				contentType: contentType || 'image/png',
			}
		}
	}

	return null
}

export function normalizeFilename(name: string): string {
	const safe = (name || 'image.png').replace(/[^\w.\-]/g, '_')
	return IMAGE_EXT.test(safe) ? safe : `${safe}.png`
}

async function downloadImage(url: string): Promise<ArrayBuffer> {
	const headers: Record<string, string> = {
		Accept: 'image/*,*/*;q=0.9',
		'User-Agent':
			'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
	}

	let response: Response
	try {
		response = await fetch(url, { method: 'GET', headers } as any)
	} catch (networkError) {
		const msg = networkError instanceof Error ? networkError.message : 'network error'
		throw new Error(`Image download failed (network: ${msg}) — check your internet`)
	}

	if (!response.ok) {
		throw new Error(`Image download failed (${response.status}) for ${url.slice(0, 80)}`)
	}

	return await response.arrayBuffer()
}

async function downloadWithFallback(image: ImageAttachment): Promise<ArrayBuffer> {
	let lastError: unknown
	const urls = [image.url, image.proxyUrl].filter(Boolean) as string[]
	const unique = [...new Set(urls)]
	for (const candidate of unique) {
		try {
			return await downloadImage(candidate)
		} catch (error) {
			lastError = error
		}
	}
	throw lastError instanceof Error ? lastError : new Error('Image download failed')
}

function ensureBlob(data: ArrayBuffer | Blob, type: string): any {
	try {
		if (typeof Blob !== 'undefined' && data instanceof Blob) return data
	} catch {}
	try {
		// @ts-ignore - Blob global in RN
		if (typeof Blob !== 'undefined') {
			// @ts-ignore
			return new Blob([data as any], { type })
		}
	} catch {}
	return data
}

function bytesToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ''
	const chunk = 0x8000
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
	}
	// Hermes/RN has no atob/btoa guarantee — fallback to manual encoder
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

// OCR.space free demo key — no user key needed for basic use.
// Users can paste their own key in Settings for higher limits.
const DEMO_KEY = 'helloworld'

async function runOcrSpace(
	image: ImageAttachment,
	settings: OcrSettings,
	data: ArrayBuffer,
): Promise<OcrResult> {
	const apiKey = (settings.apiKey || '').trim() || DEMO_KEY
	// 'all' = auto-detect (Engine 2 default). Any other value must be a
	// 3-letter OCR.space code (ara, eng, fre, ...); 'eng+ara' and codes
	// like fra/deu/hin return E201 "Value for parameter 'language' is invalid".
	const language =
		settings.language === 'all' ? 'auto' : (settings.language || 'auto').trim() || 'auto'

	const filename = normalizeFilename(image.filename)
	const contentType = image.contentType || 'image/png'

	async function doFetch(fileField: any): Promise<Response> {
		const form = new FormData() as any
		try {
			form.append('file', fileField, filename)
		} catch {
			form.append('file', fileField)
		}
		form.append('apikey', apiKey)
		form.append('language', language)
		form.append('detectOrientation', 'true')
		form.append('scale', 'true')
		form.append('OCREngine', '2')

		return await fetch('https://api.ocr.space/parse/image', {
			method: 'POST',
			body: form,
		} as any)
	}

	let response: Response
	try {
		const blobField = ensureBlob(data as any, contentType)
		response = await doFetch(blobField)
	} catch (firstError) {
		console.warn('[Hozy OCR] Blob upload failed, retrying with uri:', firstError)
		try {
			response = await doFetch({ uri: image.url, name: filename, type: contentType })
		} catch (secondError) {
			const msg = secondError instanceof Error ? secondError.message : String(secondError)
			throw new Error(`OCR upload failed (${msg})`)
		}
	}

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		throw new Error(`OCR API failed (${response.status}). ${bodyText.slice(0, 200)}`)
	}

	const json: any = await response.json().catch(() => null)
	if (json?.IsErroredOnProcessing) {
		const apiMsg = firstString(json?.ErrorMessage?.[0]) ?? 'OCR processing error'
		throw new Error(apiMsg)
	}

	// OCR.space returns ParsedResults: [{ ParsedText: "..." }, ...]
	const results = Array.isArray(json?.ParsedResults) ? json.ParsedResults : []
	const texts: string[] = []
	for (const part of results) {
		const t = firstString(part?.ParsedText, part?.text)
		if (t) texts.push(t)
	}
	if (texts.length) {
		return { text: texts.join('\n').trim(), providerUsed: 'OCR.space' }
	}

	// Fallback: some proxies flatten to top-level ParsedText
	const flattened = firstString(json?.ParsedText, json?.parsed_text, json?.Text)
	if (flattened && flattened.trim()) {
		return { text: flattened.trim(), providerUsed: 'OCR.space' }
	}

	throw new Error('OCR returned empty text (no text found in image)')
}

async function runGeminiOcr(
	image: ImageAttachment,
	settings: OcrSettings,
	data: ArrayBuffer,
): Promise<OcrResult> {
	const apiKey = (settings.apiKey || '').trim()
	if (!apiKey) {
		throw new Error(
			'Gemini API key is missing. Get a free key from aistudio.google.com and paste it in Settings.',
		)
	}
	const model = (settings.model || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash'
	const lang = settings.language === 'all' ? 'auto' : settings.language || 'auto'
	const base64 = bytesToBase64(data)

	const prompt =
		lang === 'auto'
			? 'Extract ALL text from this image exactly as written. Keep line breaks. Do not translate. If there is no text, reply exactly: NO_TEXT'
			: `Extract ALL text from this image exactly as written. Keep line breaks. Do not translate. Language hint: ${lang}. If there is no text, reply exactly: NO_TEXT`

	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
	const body = {
		contents: [
			{
				parts: [
					{ text: prompt },
					{
						inline_data: {
							mime_type: image.contentType || 'image/png',
							data: base64,
						},
					},
				],
			},
		],
		generationConfig: { temperature: 0, maxOutputTokens: 4096 },
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	} as any)

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		if (response.status === 400 || response.status === 403) {
			throw new Error(
				`Gemini rejected the request (${response.status}). Check your API key and that the Generative Language API is enabled. ${bodyText.slice(0, 150)}`,
			)
		}
		throw new Error(`Gemini API failed (${response.status}). ${bodyText.slice(0, 250)}`)
	}

	const json: any = await response.json().catch(() => null)
	const candidate = json?.candidates?.[0]
	const parts = candidate?.content?.parts ?? []
	const texts: string[] = []
	for (const part of parts) {
		const t = firstString(part?.text)
		if (t) texts.push(t)
	}
	const text = texts.join('\n').trim()
	if (!text) throw new Error('Gemini returned empty text (no text found in image)')
	if (text === 'NO_TEXT') throw new Error('OCR returned empty text (no text found in image)')
	return { text, providerUsed: `Gemini (${model})` }
}

export async function runOcr(
	image: ImageAttachment,
	settings: OcrSettings,
): Promise<OcrResult> {
	const data = await downloadWithFallback(image)
	if (settings.provider === 'gemini') {
		return runGeminiOcr(image, settings, data)
	}
	return runOcrSpace(image, settings, data)
}

export function getProviderLabel(provider: OcrProvider): string {
	return provider === 'gemini' ? 'Google Gemini (vision)' : 'OCR.space (free)'
}
