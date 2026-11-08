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
import { getLanguageName, SOURCE_LANGUAGES } from './languages'
import { LanguagePickerModal } from './picker'
import type { TranscriptionProvider } from './transcriber'
import { getProviderLabel } from './transcriber'

export interface VoiceTranscriberSettings {
	provider: TranscriptionProvider
	apiKey: string
	customEndpoint: string
	model: string
	language: string
	forceArabic: boolean
	showPopup: boolean
}

export const DEFAULT_SETTINGS: VoiceTranscriberSettings = {
	provider: 'auto',
	apiKey: '',
	customEndpoint: '',
	model: '',
	language: 'ar',
	forceArabic: true,
	showPopup: true,
}

let storageInstance:
	| ReturnType<typeof getJsonStorage<VoiceTranscriberSettings>>
	| undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<VoiceTranscriberSettings>(
			pluginStoragePathFor('com.hozy.voice-transcriber', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): VoiceTranscriberSettings {
	return {
		...DEFAULT_SETTINGS,
		...(getStorage().cache as Partial<VoiceTranscriberSettings> | undefined),
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
	const customEndpoint = s.customEndpoint ?? ''
	const model = s.model ?? ''
	const language = s.language ?? 'ar'
	const forceArabic = s.forceArabic ?? true
	const showPopup = s.showPopup ?? true

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="Transcription Provider">
				<Design.TableRadioGroup
					value={provider}
					onChange={(val: TranscriptionProvider) => storage.set({ provider: val })}
				>
					<Design.TableRadioRow
						label="Auto — no key (HuggingFace)"
						subLabel="Tries free Whisper without a key first"
						value="auto"
						onPress={() => storage.set({ provider: 'auto' as TranscriptionProvider })}
					/>
					<Design.TableRadioRow
						label="Groq (recommended free)"
						subLabel="Fast Whisper, free tier, no credit card"
						value="groq"
						onPress={() => storage.set({ provider: 'groq' as TranscriptionProvider })}
					/>
					<Design.TableRadioRow
						label="HuggingFace Whisper"
						subLabel="Free with a read token"
						value="huggingface"
						onPress={() => storage.set({ provider: 'huggingface' as TranscriptionProvider })}
					/>
					<Design.TableRadioRow
						label="OpenAI Whisper"
						subLabel="Paid, requires OpenAI key"
						value="openai"
						onPress={() => storage.set({ provider: 'openai' as TranscriptionProvider })}
					/>
					<Design.TableRadioRow
						label="Custom endpoint"
						subLabel="Your own Whisper-compatible URL"
						value="custom"
						onPress={() => storage.set({ provider: 'custom' as TranscriptionProvider })}
					/>
				</Design.TableRadioGroup>
				<Design.TableRow
					label="Selected"
					subLabel={getProviderLabel(provider)}
				/>
			</Design.TableRowGroup>

			<Design.TableRowGroup
				title="API Key"
				description="Best free key: Groq (console.groq.com) — create a free key, paste it here, set provider to Groq."
			>
				<TextField
					placeholder="Paste API key (e.g. gsk_... for Groq)"
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

			{(provider === 'custom') && (
				<Design.TableRowGroup
					title="Custom Endpoint"
					description="Full URL of your Whisper-compatible endpoint, e.g. https://your-server/audio/transcriptions"
				>
					<TextField
						placeholder="https://your-server/audio/transcriptions"
						value={customEndpoint}
						onChange={v => storage.set({ customEndpoint: v })}
					/>
				</Design.TableRowGroup>
			)}

			<Design.TableRowGroup
				title="Advanced"
				description="Force Arabic ON = always decode as Arabic (fix Saudi dialect mis-detected as Icelandic). Tap any row to toggle."
			>
				<TextField
					placeholder="Model (optional, e.g. whisper-large-v3-turbo)"
					value={model}
					onChange={v => storage.set({ model: v })}
				/>
				<Design.TableRow
					label="Language hint"
					subLabel={getLanguageName(language)}
					arrow
					onPress={() => setShowLangPicker(true)}
				/>
				<Design.TableRow
					label="Force Arabic"
					subLabel={forceArabic ? 'ON — always Arabic (dialect-safe)' : 'OFF — use hint above'}
					arrow
					onPress={() => {
						const next = !forceArabic
						storage.set({ forceArabic: next })
						if (next) storage.set({ language: 'ar' })
					}}
				/>
				<Design.TableRow
					label="Show transcript popup"
					subLabel={showPopup ? 'ON — show Copy popup' : 'OFF — chat message only'}
					arrow
					onPress={() => storage.set({ showPopup: !showPopup })}
				/>
			</Design.TableRowGroup>

			{showLangPicker && (
				<LanguagePickerModal
					visible={showLangPicker}
					title="Language Hint"
					languages={SOURCE_LANGUAGES}
					selectedCode={language}
					onSelect={code => storage.set({ language: code })}
					onClose={() => setShowLangPicker(false)}
				/>
			)}

			<Design.TableRowGroup
				title="How to use"
				description="Long-press any voice message → Transcribe. The transcript appears as a local message only you can see (plus a Copy popup if enabled). To translate it, install Hozy's Translator too and tap its Translate action on the transcript. Re-pressing Transcribe on the same message loads from cache instantly (100 entries max)."
			>
				<Design.TableRow label="Transcribe" subLabel="Local only" />
				<Design.TableRow
					label="Clear transcript cache"
					subLabel="Removes saved transcripts on this device"
					arrow
					onPress={() => clearCache()}
				/>
			</Design.TableRowGroup>
			</ScrollView>
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
