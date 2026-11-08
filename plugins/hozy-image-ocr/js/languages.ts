export interface LanguageItem {
	code: string
	name: string
}

// OCR.space language codes — 3 letters only, per https://ocr.space/ocrapi
// Engine 2 default is `auto`. The list below is every code the API
// accepts; any other value returns E201 ("Value for parameter 'language' is invalid").
export const OCR_LANGUAGES: LanguageItem[] = [
	{ code: 'all', name: 'Auto (recommended — detects all languages)' },
	{ code: 'ara', name: 'Arabic' },
	{ code: 'eng', name: 'English' },
	{ code: 'fre', name: 'French' },
	{ code: 'ger', name: 'German' },
	{ code: 'spa', name: 'Spanish' },
	{ code: 'ita', name: 'Italian' },
	{ code: 'por', name: 'Portuguese' },
	{ code: 'dut', name: 'Dutch' },
	{ code: 'pol', name: 'Polish' },
	{ code: 'rus', name: 'Russian' },
	{ code: 'ukr', name: 'Ukrainian' },
	{ code: 'tur', name: 'Turkish' },
	{ code: 'jpn', name: 'Japanese' },
	{ code: 'kor', name: 'Korean' },
	{ code: 'chs', name: 'Chinese (Simplified)' },
	{ code: 'cht', name: 'Chinese (Traditional)' },
	{ code: 'tha', name: 'Thai' },
	{ code: 'vnm', name: 'Vietnamese' },
	{ code: 'swe', name: 'Swedish' },
	{ code: 'dan', name: 'Danish' },
	{ code: 'fin', name: 'Finnish' },
	{ code: 'cze', name: 'Czech' },
	{ code: 'hun', name: 'Hungarian' },
	{ code: 'gre', name: 'Greek' },
	{ code: 'bul', name: 'Bulgarian' },
	{ code: 'hrv', name: 'Croatian' },
	{ code: 'slv', name: 'Slovenian' },
]

const LANGUAGE_NAMES = new Map(OCR_LANGUAGES.map(l => [l.code, l.name]))

export function getLanguageName(code: string): string {
	return LANGUAGE_NAMES.get(code) ?? code
}
