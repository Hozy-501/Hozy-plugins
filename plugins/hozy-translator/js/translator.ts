export type TranslationService = 'google' | 'microsoft' | 'brave'

export interface TranslationResult {
	translatedText: string
	detectedSource?: string
	serviceUsed: TranslationService
}

const MS_LANG: Record<string, string> = {
	'zh-CN': 'zh-Hans',
	'zh-TW': 'zh-Hant',
	he: 'he',
	jw: 'jv',
	fil: 'fil',
}

let msToken: { value: string; expiresAt: number } | null = null

function normalizeMsLang(code: string): string {
	return MS_LANG[code] ?? code
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
}

function parseGooglePayload(data: any): TranslationResult {
	let translatedText = ''
	if (Array.isArray(data?.[0])) {
		for (const part of data[0]) {
			if (typeof part?.[0] === 'string') translatedText += part[0]
		}
	}

	translatedText = translatedText.trim()
	if (!translatedText)
		throw new Error('Google Translate returned an empty result')

	return {
		translatedText,
		detectedSource: firstString(data?.[2], data?.[8]?.[0]?.[0]),
		serviceUsed: 'google',
	}
}

async function translateGoogle(
	text: string,
	from: string,
	to: string,
): Promise<TranslationResult> {
	const params = new URLSearchParams({
		client: 'gtx',
		sl: from === 'auto' ? 'auto' : from,
		tl: to,
		dt: 't',
		q: text,
	})

	try {
		const response = await fetch(
			'https://translate.googleapis.com/translate_a/single',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
				},
				body: params.toString(),
			},
		)
		if (!response.ok)
			throw new Error(`Google Translate failed (${response.status})`)
		return parseGooglePayload(await response.json())
	} catch {
		const response = await fetch(
			`https://translate.googleapis.com/translate_a/single?${params.toString()}`,
		)
		if (!response.ok)
			throw new Error(`Google Translate failed (${response.status})`)
		return parseGooglePayload(await response.json())
	}
}

async function getMicrosoftToken(): Promise<string> {
	if (msToken && Date.now() < msToken.expiresAt) return msToken.value

	const response = await fetch('https://edge.microsoft.com/translate/auth')
	if (!response.ok)
		throw new Error(`Microsoft auth failed (${response.status})`)

	const value = (await response.text()).trim()
	if (!value) throw new Error('Microsoft auth returned an empty token')

	msToken = { value, expiresAt: Date.now() + 8 * 60 * 1000 }
	return value
}

async function translateMicrosoft(
	text: string,
	from: string,
	to: string,
): Promise<TranslationResult> {
	const token = await getMicrosoftToken()
	const params = new URLSearchParams({
		'api-version': '3.0',
		to: normalizeMsLang(to),
		includeSentenceLength: 'true',
	})
	if (from !== 'auto') params.set('from', normalizeMsLang(from))

	const response = await fetch(
		`https://api-edge.cognitive.microsofttranslator.com/translate?${params.toString()}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify([{ Text: text }]),
		},
	)

	if (!response.ok)
		throw new Error(`Microsoft Translator failed (${response.status})`)

	const data = await response.json()
	const translatedText = firstString(data?.[0]?.translations?.[0]?.text)
	if (!translatedText)
		throw new Error('Microsoft Translator returned an empty result')

	return {
		translatedText,
		detectedSource: firstString(data?.[0]?.detectedLanguage?.language),
		serviceUsed: 'microsoft',
	}
}

function parseBravePayload(data: any): TranslationResult {
	const translatedText = firstString(
		data?.translatedText,
		data?.translated_text,
		data?.translation,
		data?.result,
		data?.text,
		data?.[0]?.translatedText,
		data?.[0]?.text,
	)
	if (!translatedText)
		throw new Error('Brave Translate returned an empty result')

	return {
		translatedText,
		detectedSource: firstString(
			data?.detectedSource,
			data?.detected_source,
			data?.source,
			data?.from,
		),
		serviceUsed: 'brave',
	}
}

async function translateBrave(
	text: string,
	from: string,
	to: string,
): Promise<TranslationResult> {
	const sl = from === 'auto' ? 'auto' : from
	const payload = { q: text, source: sl, target: to, sl, tl: to }

	try {
		const response = await fetch('https://search.brave.com/api/translate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		if (!response.ok)
			throw new Error(`Brave Translate failed (${response.status})`)
		return parseBravePayload(await response.json())
	} catch {
		const params = new URLSearchParams({ q: text, sl, tl: to })
		const response = await fetch(
			`https://search.brave.com/api/translate?${params.toString()}`,
		)
		if (!response.ok)
			throw new Error(`Brave Translate failed (${response.status})`)
		return parseBravePayload(await response.json())
	}
}

const ENGINES: Record<
	TranslationService,
	(text: string, from: string, to: string) => Promise<TranslationResult>
> = {
	google: translateGoogle,
	microsoft: translateMicrosoft,
	brave: translateBrave,
}

const FALLBACK_ORDER: TranslationService[] = ['google', 'microsoft', 'brave']

export async function translateText(
	text: string,
	service: TranslationService,
	from: string,
	to: string,
): Promise<TranslationResult> {
	const trimmed = text.trim()
	if (!trimmed) throw new Error('Nothing to translate')

	const order = [
		service,
		...FALLBACK_ORDER.filter(engine => engine !== service),
	]
	let lastError: unknown

	for (const engine of order) {
		try {
			return await ENGINES[engine](trimmed, from, to)
		} catch (error) {
			lastError = error
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Translation failed')
}

export function getEngineLabel(service: TranslationService): string {
	if (service === 'microsoft') return 'Microsoft Translator'
	if (service === 'brave') return 'Brave Translate'
	return 'Google Translate'
}
