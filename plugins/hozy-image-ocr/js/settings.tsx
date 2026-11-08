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
import type { OcrLanguage } from './ocr'

export interface ImageOcrSettings {
	apiKey: string
	language: OcrLanguage
	showPopup: boolean
}

export const DEFAULT_SETTINGS: ImageOcrSettings = {
	apiKey: '',
	language: 'all',
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

	const apiKey = s.apiKey ?? ''
	const language = s.language ?? 'all'
	const showPopup = s.showPopup ?? true

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="OCR Language">
					<Design.TableRadioGroup
						value={language}
						onChange={(val: OcrLanguage) => storage.set({ language: val })}
					>
						<Design.TableRadioRow
							label="All languages"
							subLabel="Arabic + English (recommended)"
							value="all"
							onPress={() => storage.set({ language: 'all' as OcrLanguage })}
						/>
						<Design.TableRadioRow
							label="Arabic only"
							subLabel="Best for Arabic screenshots"
							value="ara"
							onPress={() => storage.set({ language: 'ara' as OcrLanguage })}
						/>
						<Design.TableRadioRow
							label="English only"
							subLabel="Best for English screenshots"
							value="eng"
							onPress={() => storage.set({ language: 'eng' as OcrLanguage })}
						/>
					</Design.TableRadioGroup>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="API Key (optional)"
					description="Works out of the box with the free demo key. Paste your own ocr.space key for higher limits."
				>
					<TextField
						placeholder="Paste your ocr.space key (optional)"
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
