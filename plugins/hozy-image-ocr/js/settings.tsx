import { Page } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { useState } from 'react'
import {
	ScrollView,
	StyleSheet,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { clearCache } from './cache'
import { getLanguageName, OCR_LANGUAGES } from './languages'
import { LanguagePickerModal } from './picker'
import type { OcrLanguage, OcrProvider } from './ocr'
import { getProviderLabel } from './ocr'

export interface ImageOcrSettings {
	provider: OcrProvider
	apiKey: string
	language: OcrLanguage
	model: string
	showPopup: boolean
}

export const DEFAULT_SETTINGS: ImageOcrSettings = {
	provider: 'ocrspace',
	apiKey: '',
	language: 'all',
	model: '',
	showPopup: true,
}

let storageInstance:
	| ReturnType<typeof getJsonStorage<ImageOcrSettings>>
	| undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<ImageOcrSettings>(
			pluginStoragePathFor('com.hozy.image-ocr', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): ImageOcrSettings {
	return {
		...DEFAULT_SETTINGS,
		...(getStorage().cache as Partial<ImageOcrSettings> | undefined),
	}
}

function TextField({
	placeholder,
	value,
	onChange,
	secure,
}: {
	placeholder: string
	value: string
	onChange: (v: string) => void
	secure?: boolean
}) {
	return (
		<View style={styles.fieldWrap}>
			<TextInput
				value={value || ''}
				onChangeText={onChange}
				placeholder={placeholder}
				placeholderTextColor="#949ba4"
				secureTextEntry={secure}
				autoCapitalize="none"
				autoCorrect={false}
				style={styles.input}
			/>
		</View>
	)
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const [showKey, setShowKey] = useState(false)
	const [showLangPicker, setShowLangPicker] = useState(false)

	const provider = s.provider ?? DEFAULT_SETTINGS.provider
	const apiKey = s.apiKey ?? ''
	const language = s.language ?? 'all'
	const model = s.model ?? ''
	const showPopup = s.showPopup ?? true
	const isGemini = provider === 'gemini'

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="OCR Provider">
					<Design.TableRadioGroup
						value={provider}
						onChange={(val: OcrProvider) => storage.set({ provider: val })}
					>
						<Design.TableRadioRow
							label="OCR.space (free)"
							subLabel="Works without a key (demo limit)"
							value="ocrspace"
							onPress={() => storage.set({ provider: 'ocrspace' as OcrProvider })}
						/>
						<Design.TableRadioRow
							label="Google Gemini (vision)"
							subLabel="Needs Google AI Studio key — better with handwriting"
							value="gemini"
							onPress={() => storage.set({ provider: 'gemini' as OcrProvider })}
						/>
					</Design.TableRadioGroup>
					<Design.TableRow
						label="Selected"
						subLabel={getProviderLabel(provider)}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title={isGemini ? 'Gemini API Key' : 'OCRSpace API Key (optional)'}
					description={
						isGemini
							? 'Get a free key at aistudio.google.com → Get API key. Stored locally only.'
							: 'Works out of the box with the free demo key. Paste your own ocr.space key for higher limits.'
					}
				>
					<TextField
						placeholder={
							isGemini
								? 'Paste Gemini API key (AIza...)'
								: 'Paste your ocr.space key (optional)'
						}
						value={apiKey}
						onChange={v => storage.set({ apiKey: v })}
						secure={!showKey}
					/>
					<TouchableOpacity
						style={styles.toggleBtn}
						onPress={() => setShowKey(prev => !prev)}
					>
						<Design.Text variant="text-sm/medium" style={styles.toggleTxt}>
							{showKey ? 'Hide key' : 'Show key'}
						</Design.Text>
					</TouchableOpacity>
				</Design.TableRowGroup>

				{isGemini && (
					<Design.TableRowGroup
						title="Gemini Model"
						description="Leave empty for the default (gemini-2.0-flash)."
					>
						<TextField
							placeholder="Model (optional, e.g. gemini-2.0-flash)"
							value={model}
							onChange={v => storage.set({ model: v })}
						/>
					</Design.TableRowGroup>
				)}

				<Design.TableRowGroup
					title="OCR Language"
					description={
						isGemini
							? 'Language hint for the prompt. Auto is recommended.'
							: "Tap to search 40+ languages. 'All' covers Arabic + English."
					}
				>
					<Design.TableRow
						label="Document language"
						subLabel={getLanguageName(language)}
						arrow
						onPress={() => setShowLangPicker(true)}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup title="Display">
					<Design.TableRow
						label="Show transcript popup"
						subLabel={showPopup ? 'ON — show Copy popup' : 'OFF — chat message only'}
						arrow
						onPress={() => storage.set({ showPopup: !showPopup })}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="How to use"
					description="Long-press any image message → Extract Text. The result appears as a local message only you can see (plus a Copy popup if enabled). To translate it, install Hozy's Translator too and tap its Translate action on the result. Re-pressing Extract Text on the same message loads from cache instantly (100 entries max)."
				>
					<Design.TableRow label="Extract Text" subLabel="Local only" />
					<Design.TableRow
						label="Clear transcript cache"
						subLabel="Removes saved OCR results on this device"
						arrow
						onPress={() => clearCache()}
					/>
				</Design.TableRowGroup>
			</ScrollView>

			{showLangPicker && (
				<LanguagePickerModal
					visible={showLangPicker}
					title="OCR Language"
					languages={OCR_LANGUAGES}
					selectedCode={language}
					onSelect={code => storage.set({ language: code })}
					onClose={() => setShowLangPicker(false)}
				/>
			)}
		</Page>
	)
}

const styles = StyleSheet.create({
	scroll: { flex: 1 },
	scrollContent: { paddingBottom: 48 },
	fieldWrap: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	input: {
		backgroundColor: '#1e1f22',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		color: '#ffffff',
		fontSize: 14,
		borderWidth: 1,
		borderColor: '#2b2d31',
	},
	toggleBtn: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		alignSelf: 'flex-start',
	},
	toggleTxt: { color: '#5865f2' },
})
