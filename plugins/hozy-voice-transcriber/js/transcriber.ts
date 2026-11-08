export type TranscriptionProvider =
	| 'auto'
	| 'groq'
	| 'openai'
	| 'huggingface'
	| 'custom'

export interface TranscriberSettings {
	provider: TranscriptionProvider
	apiKey: string
	customEndpoint: string
	model: string
	language: string
}

export interface TranscriptionResult {
	text: string
	language?: string
	providerUsed: string
}

export interface VoiceAudio {
	url: string
	proxyUrl?: string
	filename: string
	contentType: string
}

const AUDIO_EXT = /\.(ogg|oga|opus|mp3|wav|m4a|webm|flac|aac|aiff)$/i
const VOICE_FLAG = 8192 // IS_VOICE_MESSAGE

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
}

export function getVoiceAudio(message: any): VoiceAudio | null {
	if (!message || typeof message !== 'object') return null

	const candidates: any[] = []

	if (Array.isArray(message.attachments)) {
		candidates.push(...message.attachments)
	}
	if (Array.isArray(message.embeds)) {
		// no-op, voice audio is not in embeds
	}
	if (message.attachment) candidates.push(message.attachment)
	if (message.voiceMessage) candidates.push(message.voiceMessage)
	if (message.voice_message) candidates.push(message.voice_message)
	if (Array.isArray(message.voiceMessages)) {
		candidates.push(...message.voiceMessages)
	}

	for (const att of candidates) {
		if (!att || typeof att !== 'object') continue
		const url = firstString(att.url, att.src, att.href)
		const proxyUrl = firstString(att.proxy_url)
		const bestUrl = url ?? proxyUrl
		if (!bestUrl) continue
		const filename = firstString(att.filename, att.name, att.fileName) ?? 'voice.ogg'
		const contentType =
			firstString(att.content_type, att.contentType, att.mimetype) ?? ''

		const hasDuration =
			att.duration_secs != null || att.durationSecs != null || att.duration != null
		const hasWaveform = att.waveform != null
		const flags = Number(message.flags ?? att.flags ?? 0)
		const isVoiceFlag = Number.isFinite(flags) && (flags & VOICE_FLAG) !== 0

		const isAudioType = contentType.toLowerCase().startsWith('audio/')
		const isAudioExt = AUDIO_EXT.test(filename) || AUDIO_EXT.test(bestUrl.split('?')[0] ?? '')

		if (isAudioType || isAudioExt || hasDuration || hasWaveform || isVoiceFlag) {
			return {
				url: bestUrl,
				proxyUrl,
				filename,
				contentType: contentType || 'audio/ogg',
			}
		}
	}

	// Fallback: some clients store voice message metadata in a nested field
	const nested = firstString(
		message?.voice?.url,
		message?.audio?.url,
		message?.media?.url,
	)
	if (nested) {
		return { url: nested, filename: 'voice.ogg', contentType: 'audio/ogg' }
	}

	return null
}

export function hasVoiceAudio(message: any): boolean {
	return getVoiceAudio(message) != null
}

export function normalizeFilename(name: string): string {
	const safe = (name || 'voice.ogg').replace(/[^\w.\-]/g, '_')
	return /\.(ogg|oga|opus|mp3|wav|m4a|webm|flac|aac|aiff)$/i.test(safe)
		? safe
		: `${safe}.ogg`
}

async function downloadAudio(url: string): Promise<ArrayBuffer> {
	// Discord CDN blocks plain fetch in some Android builds — it wants a
	// User-Agent + Accept header. Hermes also lacks response.blob(),
	// so use arrayBuffer() FIRST (blob() fallback only).
	const headers: Record<string, string> = {
		Accept: 'audio/*,*/*;q=0.9',
		'User-Agent':
			'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
	}

	let response: Response
	try {
		response = await fetch(url, { method: 'GET', headers } as any)
	} catch (networkError) {
		const msg = networkError instanceof Error ? networkError.message : 'network error'
		throw new Error(`Audio download failed (network: ${msg}) — check your internet`)
	}

	if (!response.ok) {
		throw new Error(`Audio download failed (${response.status}) for ${url.slice(0, 80)}`)
	}

	try {
		return await response.arrayBuffer()
	} catch {
		// Last resort for runtimes without arrayBuffer support
		const blob = await (response as any).blob()
		const buf = await blob.arrayBuffer()
		return buf as ArrayBuffer
	}
}

async function downloadAudioWithFallback(audio: VoiceAudio): Promise<ArrayBuffer> {
	let lastError: unknown
	const urls = [audio.url, audio.proxyUrl].filter(Boolean) as string[]
	// de-dupe
	const unique = [...new Set(urls)]
	for (const candidate of unique) {
		try {
			return await downloadAudio(candidate)
		} catch (error) {
			lastError = error
		}
	}
	throw lastError instanceof Error ? lastError : new Error('Audio download failed')
}

function ensureBlob(data: ArrayBuffer | Blob, type: string): any {
	// React Native exposes Blob; in Hermes, Blob constructor may exist
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

async function transcribeHuggingFace(
	data: ArrayBuffer | Blob,
	settings: TranscriberSettings,
): Promise<TranscriptionResult> {
	const model = (settings.model || 'openai/whisper-large-v3').trim()
	const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`

	const headers: Record<string, string> = {}
	const token = (settings.apiKey || '').trim()
	if (settings.provider === 'huggingface' && token) {
		headers.Authorization = `Bearer ${token}`
	}
	// For 'auto' we intentionally send NO Authorization (keyless attempt)

	const body: any = ensureBlob(data as any, 'audio/ogg')
	const response = await fetch(url, {
		method: 'POST',
		headers,
		body,
	} as any)

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		throw new Error(
			`HuggingFace Whisper failed (${response.status}). ${bodyText.slice(0, 200)}`,
		)
	}

	const json: any = await response.json().catch(() => null)
	const text = firstString(json?.text, json?.[0]?.text)
	if (!text) throw new Error('Transcription returned empty text')
	return {
		text,
		language: firstString(json?.language),
		providerUsed: token ? 'HuggingFace (with token)' : 'HuggingFace (no key)',
	}
}

async function transcribeMultipart(
	endpoint: string,
	apiKey: string,
	model: string,
	audio: VoiceAudio,
	data: ArrayBuffer | Blob,
	settings: TranscriberSettings,
): Promise<TranscriptionResult> {
	const filename = normalizeFilename(audio.filename)
	const contentType = audio.contentType || 'audio/ogg'
	const lang = (settings.language || '').trim()

	async function doFetch(fileField: any): Promise<Response> {
		const form = new FormData() as any
		try {
			form.append('file', fileField, filename)
		} catch {
			form.append('file', fileField)
		}
		if (model) form.append('model', model)
		form.append('response_format', 'json')
		if (lang && lang !== 'auto') form.append('language', lang)
		// Vocab primer: forces Arabic decoding even for Saudi dialect
		// clips where auto-detect misfires (e.g. as Icelandic).
		if (lang === 'ar' || lang === 'ar-SA') {
			form.append(
				'prompt',
				'مرحباً، هلا، وش العلوم، كيف حالك، هذا اختبار باللغة العربية',
			)
		}

		const headers: Record<string, string> = {}
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`

		return await fetch(endpoint, {
			method: 'POST',
			headers,
			body: form,
		} as any)
	}

	let response: Response
	try {
		// 1st attempt: Blob built from downloaded bytes
		const blobField = ensureBlob(data as any, contentType)
		response = await doFetch(blobField)
	} catch (firstError) {
		// React Native FormData often refuses Blob — retry with the RN
		// {uri, name, type} file object pointing at the CDN URL directly.
		console.warn('[Hozy Voice] Blob upload failed, retrying with uri:', firstError)
		try {
			response = await doFetch({ uri: audio.url, name: filename, type: contentType })
		} catch (secondError) {
			const msg = secondError instanceof Error ? secondError.message : String(secondError)
			throw new Error(`Transcription upload failed (${msg})`)
		}
	}

	if (!response.ok) {
		const bodyText = await response.text().catch(() => '')
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`Invalid or missing API key (${response.status}). Best free key: Groq (console.groq.com) — paste it in Settings.`,
			)
		}
		throw new Error(`Transcription API failed (${response.status}). ${bodyText.slice(0, 250)}`)
	}

	const json: any = await response.json().catch(() => null)
	const text = firstString(json?.text)
	if (!text) throw new Error('Transcription returned empty text')
	return {
		text,
		language: firstString(json?.language),
		providerUsed: endpoint.includes('groq') ? 'Groq Whisper' : 'Whisper API',
	}
}

export async function transcribeAudio(
	audio: VoiceAudio,
	settings: TranscriberSettings,
): Promise<TranscriptionResult> {
	const data = await downloadAudioWithFallback(audio)
	const provider = settings.provider || 'auto'

	// User asked: try without key first. So auto = keyless HuggingFace attempt.
	if (provider === 'auto') {
		return transcribeHuggingFace(data, settings)
	}

	if (provider === 'huggingface') {
		return transcribeHuggingFace(data, settings)
	}

	if (provider === 'groq') {
		const model = (settings.model || 'whisper-large-v3-turbo').trim()
		return transcribeMultipart(
			'https://api.groq.com/openai/v1/audio/transcriptions',
			(settings.apiKey || '').trim(),
			model,
			audio,
			data,
			settings,
		)
	}

	if (provider === 'openai') {
		const model = (settings.model || 'whisper-1').trim()
		return transcribeMultipart(
			'https://api.openai.com/v1/audio/transcriptions',
			(settings.apiKey || '').trim(),
			model,
			audio,
			data,
			settings,
		)
	}

	// custom
	const endpoint = (settings.customEndpoint || '').trim()
	if (!endpoint) throw new Error('Custom endpoint URL is empty in Settings')
	const model = (settings.model || 'whisper-1').trim()
	return transcribeMultipart(
		endpoint,
		(settings.apiKey || '').trim(),
		model,
		audio,
		data,
		settings,
	)
}

export function getProviderLabel(provider: string): string {
	switch (provider) {
		case 'groq':
			return 'Groq (recommended free)'
		case 'openai':
			return 'OpenAI Whisper'
		case 'huggingface':
			return 'HuggingFace Whisper'
		case 'custom':
			return 'Custom endpoint'
		default:
			return 'Auto — no key (HuggingFace)'
	}
}
