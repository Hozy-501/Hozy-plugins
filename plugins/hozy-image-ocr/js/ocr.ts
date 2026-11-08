export type OcrLanguage = 'all' | 'ara' | 'eng'

export interface OcrSettings {
	apiKey: string
	language: OcrLanguage
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

// OCR.space free demo key — no user key needed for basic use.
// Users can paste their own key in Settings for higher limits.
const DEMO_KEY = 'helloworld'

export async function runOcr(
	image: ImageAttachment,
	settings: OcrSettings,
): Promise<OcrResult> {
	const data = await downloadWithFallback(image)
	const apiKey = (settings.apiKey || '').trim() || DEMO_KEY
	const language =
		settings.language === 'all' ? 'eng+ara' : settings.language === 'ara' ? 'ara' : 'eng'

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

	const parsed = json?.ParsedText ?? json?.parsed_text ?? ''
	if (Array.isArray(parsed)) {
		const text = parsed.join('\n').trim()
		if (!text) throw new Error('OCR returned empty text (no text found in image)')
		return { text, providerUsed: 'OCR.space' }
	}

	const first = Array.isArray(json?.ParsedText) ? json.ParsedText[0] : json?.ParsedText
	const text = firstString(first) ?? firstString(json?.Text, json?.text)
	if (text && text.trim()) {
		return { text: text.trim(), providerUsed: 'OCR.space' }
	}

	// Some responses expose ParsedText array with object
	const texts: string[] = []
	if (Array.isArray(json?.ParsedText)) {
		for (const part of json.ParsedText) {
			const t = firstString(part?.ParsedText, part?.text)
			if (t) texts.push(t)
		}
	}
	if (texts.length) return { text: texts.join('\n'), providerUsed: 'OCR.space' }

	throw new Error('OCR returned empty text (no text found in image)')
}
