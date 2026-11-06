import { Page } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { useState } from 'react'
import {
	getLanguageName,
	SOURCE_LANGUAGES,
	TARGET_LANGUAGES,
} from './languages'
import { LanguagePickerModal } from './picker'
import type { TranslationService } from './translator'

export interface TranslatorSettings {
	service: TranslationService
	fromLanguage: string
	toLanguage: string
}

export const DEFAULT_SETTINGS: TranslatorSettings = {
	service: 'google',
	fromLanguage: 'auto',
	toLanguage: 'ar',
}

let storageInstance:
	| ReturnType<typeof getJsonStorage<TranslatorSettings>>
	| undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<TranslatorSettings>(
			pluginStoragePathFor('com.hozy.translator', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): TranslatorSettings {
	return {
		...DEFAULT_SETTINGS,
		...(getStorage().cache as Partial<TranslatorSettings> | undefined),
	}
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const [pickerType, setPickerType] = useState<'from' | 'to' | null>(null)

	const service = s.service ?? DEFAULT_SETTINGS.service
	const fromLang = s.fromLanguage ?? DEFAULT_SETTINGS.fromLanguage
	const toLang = s.toLanguage ?? DEFAULT_SETTINGS.toLanguage

	return (
		<Page>
			<Design.TableRowGroup title="Translation Engine">
				<Design.TableRadioGroup
					value={service}
					onChange={(val: TranslationService) => storage.set({ service: val })}
				>
					<Design.TableRadioRow
						label="Google Translate"
						subLabel="Free and fast — no API key needed"
						value="google"
						onPress={() => storage.set({ service: 'google' })}
					/>
					<Design.TableRadioRow
						label="Microsoft Translator"
						subLabel="Powered by Edge Translator"
						value="microsoft"
						onPress={() => storage.set({ service: 'microsoft' })}
					/>
					<Design.TableRadioRow
						label="Brave Translate"
						subLabel="Falls back automatically if it fails"
						value="brave"
						onPress={() => storage.set({ service: 'brave' })}
					/>
				</Design.TableRadioGroup>
			</Design.TableRowGroup>

			<Design.TableRowGroup title="Languages">
				<Design.TableRow
					label="Translate From"
					subLabel={getLanguageName(fromLang)}
					arrow
					onPress={() => setPickerType('from')}
				/>
				<Design.TableRow
					label="Translate To"
					subLabel={getLanguageName(toLang)}
					arrow
					onPress={() => setPickerType('to')}
				/>
			</Design.TableRowGroup>

			{pickerType === 'from' && (
				<LanguagePickerModal
					visible
					title="Source Language"
					languages={SOURCE_LANGUAGES}
					selectedCode={fromLang}
					onSelect={code => storage.set({ fromLanguage: code })}
					onClose={() => setPickerType(null)}
				/>
			)}

			{pickerType === 'to' && (
				<LanguagePickerModal
					visible
					title="Target Language"
					languages={TARGET_LANGUAGES}
					selectedCode={toLang}
					onSelect={code => storage.set({ toLanguage: code })}
					onClose={() => setPickerType(null)}
				/>
			)}
		</Page>
	)
}
