export interface LanguageItem {
	code: string
	name: string
}

// OCR.space language codes (see https://ocr.space/OCR_API)
export const OCR_LANGUAGES: LanguageItem[] = [
	{ code: 'all', name: 'All languages (Arabic + English)' },
	{ code: 'ara', name: 'Arabic' },
	{ code: 'eng', name: 'English' },
	{ code: 'fra', name: 'French' },
	{ code: 'deu', name: 'German' },
	{ code: 'spa', name: 'Spanish' },
	{ code: 'ita', name: 'Italian' },
	{ code: 'por', name: 'Portuguese' },
	{ code: 'nld', name: 'Dutch' },
	{ code: 'pol', name: 'Polish' },
	{ code: 'rus', name: 'Russian' },
	{ code: 'ukr', name: 'Ukrainian' },
	{ code: 'tur', name: 'Turkish' },
	{ code: 'hin', name: 'Hindi' },
	{ code: 'jpn', name: 'Japanese' },
	{ code: 'kor', name: 'Korean' },
	{ code: 'chi_sim', name: 'Chinese (Simplified)' },
	{ code: 'chi_tra', name: 'Chinese (Traditional)' },
	{ code: 'heb', name: 'Hebrew' },
	{ code: 'tha', name: 'Thai' },
	{ code: 'vie', name: 'Vietnamese' },
	{ code: 'idn', name: 'Indonesian' },
	{ code: 'msa', name: 'Malay' },
	{ code: 'fil', name: 'Filipino' },
	{ code: 'swa', name: 'Swahili' },
	{ code: 'fas', name: 'Persian (Farsi)' },
	{ code: 'urd', name: 'Urdu' },
	{ code: 'ben', name: 'Bengali' },
	{ code: 'tam', name: 'Tamil' },
	{ code: 'tel', name: 'Telugu' },
	{ code: 'swe', name: 'Swedish' },
	{ code: 'dan', name: 'Danish' },
	{ code: 'nor', name: 'Norwegian' },
	{ code: 'fin', name: 'Finnish' },
	{ code: 'cze', name: 'Czech' },
	{ code: 'hun', name: 'Hungarian' },
	{ code: 'gre', name: 'Greek' },
	{ code: 'rum', name: 'Romanian' },
	{ code: 'bul', name: 'Bulgarian' },
	{ code: 'hrv', name: 'Croatian' },
	{ code: 'slv', name: 'Slovenian' },
	{ code: 'srp', name: 'Serbian' },
	{ code: 'slo', name: 'Slovak' },
]

const LANGUAGE_NAMES = new Map(OCR_LANGUAGES.map(l => [l.code, l.name]))

export function getLanguageName(code: string): string {
	return LANGUAGE_NAMES.get(code) ?? code
}
