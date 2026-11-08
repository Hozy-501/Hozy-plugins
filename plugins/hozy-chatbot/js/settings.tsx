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
import {
	DEFAULT_SYSTEM_PROMPT,
	getProviderLabel,
	type LlmProvider,
} from './llm'

export interface ChatbotSettings {
	provider: LlmProvider
	apiKey: string
	model: string
	customEndpoint: string
	systemPrompt: string
}

export const DEFAULT_SETTINGS: ChatbotSettings = {
	provider: 'groq',
	apiKey: '',
	model: '',
	customEndpoint: '',
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
}

let storageInstance: ReturnType<typeof getJsonStorage<ChatbotSettings>> | undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<ChatbotSettings>(
			pluginStoragePathFor('com.hozy.chatbot', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): ChatbotSettings {
	return {
		...DEFAULT_SETTINGS,
		...(getStorage().cache as Partial<ChatbotSettings> | undefined),
	}
}

function TextField({
	placeholder,
	value,
	onChange,
	secure,
	multiline,
}: {
	placeholder: string
	value: string
	onChange: (v: string) => void
	secure?: boolean
	multiline?: boolean
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
				multiline={multiline}
				style={[styles.input, multiline ? styles.inputMulti : undefined]}
			/>
		</View>
	)
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const [showKey, setShowKey] = useState(false)

	const provider = s.provider ?? DEFAULT_SETTINGS.provider
	const apiKey = s.apiKey ?? ''
	const model = s.model ?? ''
	const customEndpoint = s.customEndpoint ?? ''
	const systemPrompt = s.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
	const isCustom = provider === 'custom'

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="AI Provider">
					<Design.TableRadioGroup
						value={provider}
						onChange={(val: LlmProvider) => storage.set({ provider: val })}
					>
						<Design.TableRadioRow
							label="Groq (free, recommended)"
							subLabel="Fast, free tier, OpenAI-compatible"
							value="groq"
							onPress={() => storage.set({ provider: 'groq' as LlmProvider })}
						/>
						<Design.TableRadioRow
							label="Google Gemini"
							subLabel="Great with images, free via AI Studio"
							value="gemini"
							onPress={() => storage.set({ provider: 'gemini' as LlmProvider })}
						/>
						<Design.TableRadioRow
							label="OpenAI"
							subLabel="Paid, GPT models"
							value="openai"
							onPress={() => storage.set({ provider: 'openai' as LlmProvider })}
						/>
						<Design.TableRadioRow
							label="Custom OpenAI-compatible"
							subLabel="Your own endpoint"
							value="custom"
							onPress={() => storage.set({ provider: 'custom' as LlmProvider })}
						/>
					</Design.TableRadioGroup>
					<Design.TableRow
						label="Selected"
						subLabel={getProviderLabel(provider)}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="API Key"
					description="Stored on this device only. Groq: console.groq.com. Gemini: aistudio.google.com."
				>
					<TextField
						placeholder={
							provider === 'gemini'
								? 'Paste Gemini API key (AIza...)'
								: 'Paste API key'
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

				<Design.TableRowGroup
					title="Model"
					description="Leave empty for the provider default."
				>
					<TextField
						placeholder={
							provider === 'gemini'
								? 'Model (e.g. gemini-2.0-flash)'
								: provider === 'groq'
									? 'Model (e.g. llama-3.3-70b-versatile)'
									: 'Model (e.g. gpt-4o-mini)'
						}
						value={model}
						onChange={v => storage.set({ model: v })}
					/>
				</Design.TableRowGroup>

				{isCustom ? (
					<Design.TableRowGroup
						title="Custom Endpoint"
						description="Full chat completions URL."
					>
						<TextField
							placeholder="https://your-server/v1/chat/completions"
							value={customEndpoint}
							onChange={v => storage.set({ customEndpoint: v })}
						/>
					</Design.TableRowGroup>
				) : null}

				<Design.TableRowGroup
					title="System Prompt"
					description="Defines the bot's role. Default is a programming assistant with Discord markdown."
				>
					<TextField
						placeholder="System prompt…"
						value={systemPrompt}
						onChange={v => storage.set({ systemPrompt: v })}
						multiline
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="How to use"
					description="Type /ask <question> in any chat. It answers as a normal local message (markdown: *text* / **text** / `code`). Links in your question are fetched, image URLs are shown to the model (Gemini/Groq vision models)."
				>
					<Design.TableRow label="/ask" subLabel="Local only" />
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
	inputMulti: { minHeight: 120, textAlignVertical: 'top' },
	toggleBtn: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		alignSelf: 'flex-start',
	},
	toggleTxt: { color: '#5865f2' },
})
