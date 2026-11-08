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
		const url = firstString(att.url, att.proxy_url, att.src, att.href)
		if (!url) continue
		const filename = firstString(att.filename, att.name, att.fileName) ?? 'voice.ogg'
		const contentType =
			firstString(att.content_type, att.contentType, att.mimetype) ?? ''

		const hasDuration =
			att.duration_secs != null || att.durationSecs != null || att.duration != null
		const hasWaveform = att.waveform != null
		const flags = Number(message.flags ?? att.flags ?? 0)
		const isVoiceFlag = Number.isFinite(flags) && (flags & VOICE_FLAG) !== 0

		const isAudioType = contentType.toLowerCase().startsWith('audio/')
		const isAudioExt = AUDIO_EXT.test(filename) || AUDIO_EXT.test(url.split('?')[0] ?? '')

		if (isAudioType || isAudioExt || hasDuration || hasWaveform || isVoiceFlag) {
			return {
				url,
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

async function downloadAudio(url: string): Promise<Blob | ArrayBuffer> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Audio download failed (${response.status})`)
	}
	// Prefer arrayBuffer for binary POST (HuggingFace) and Blob for FormData
	try {
		return await response.blob()
	} catch {
		return await response.arrayBuffer()
	}
}

function ensureBlob(data: Blob | ArrayBuffer, type: string): any {
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
	data: Blob | ArrayBuffer,
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
	data: Blob | ArrayBuffer,
	filename: string,
	contentType: string,
	settings: TranscriberSettings,
): Promise<TranscriptionResult> {
	const form = new FormData() as any

	const fileField: any = ensureBlob(data as any, contentType || 'audio/ogg')

	// React Native FormData accepts {uri,name,type} OR Blob depending on runtime.
	// Try Blob first, fall back to uri object is not possible here (we have bytes).
	try {
		form.append('file', fileField, normalizeFilename(filename))
	} catch {
		form.append('file', fileField)
	}

	if (model) form.append('model', model)
	form.append('response_format', 'json')
	const lang = (settings.language || '').trim()
	if (lang && lang !== 'auto') form.append('language', lang)

	const headers: Record<string, string> = {}
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`

	const response = await fetch(endpoint, {
		method: 'POST',
		headers,
		body: form,
	} as any)

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
	const data = await downloadAudio(audio.url)
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
			data,
			audio.filename,
			audio.contentType,
			settings,
		)
	}

	if (provider === 'openai') {
		const model = (settings.model || 'whisper-1').trim()
		return transcribeMultipart(
			'https://api.openai.com/v1/audio/transcriptions',
			(settings.apiKey || '').trim(),
			model,
			data,
			audio.filename,
			audio.contentType,
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
		data,
		audio.filename,
		audio.contentType,
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
