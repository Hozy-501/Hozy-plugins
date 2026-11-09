import { Page } from '@valenced/components'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { useMemo, useState } from 'react'
import {
	Modal,
	ScrollView,
	StyleSheet,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import {
	askLlm,
	bytesToBase64,
	DEFAULT_SYSTEM_PROMPT,
	getProviderLabel,
	type ChatAttachment,
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

// ---------- Chat sessions (light: 20 sessions × 50 messages) ----------

export interface ChatMessage {
	role: 'user' | 'assistant'
	content: string
	at: number
}

export interface ChatSession {
	id: string
	title: string
	createdAt: number
	updatedAt: number
	messages: ChatMessage[]
}

const MAX_SESSIONS = 20
const MAX_MSGS = 50

let sessionsStorage: ReturnType<typeof getJsonStorage<ChatSession[]>> | undefined

export function getSessionsStorage() {
	if (!sessionsStorage) {
		sessionsStorage = getJsonStorage<ChatSession[]>(
			pluginStoragePathFor('com.hozy.chatbot', 'sessions.json'),
			{ default: [], load: true },
		)
	}
	return sessionsStorage
}

export function getSessions(): ChatSession[] {
	const cache = getSessionsStorage().cache as ChatSession[] | undefined
	return cache ?? []
}

function newSession(): ChatSession {
	const at = Date.now()
	return { id: `s${at}`, title: 'New chat', createdAt: at, updatedAt: at, messages: [] }
}

function upsertSession(session: ChatSession) {
	const list = getSessions()
	const idx = list.findIndex(s => s.id === session.id)
	const next = idx >= 0 ? [...list] : [session, ...list]
	if (idx >= 0) next[idx] = session
	const trimmed = [...next].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
	void getSessionsStorage().set(trimmed)
}

function deleteSession(id: string) {
	const list = getSessions().filter(s => s.id !== id)
	void getSessionsStorage().set(list)
}

function showToast(text: string, variant: 'default' | 'success' | 'critical' = 'default') {
	try {
		ToastActionCreators.open('hozy-chatbot', { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key: 'hozy-chatbot', content: text })
		} catch {}
	}
}

function copyToClipboard(text: string): boolean {
	try {
		const [clip] = lookupModule(withProps('setString', 'getString'))
		const api: any = clip as any
		const setFn =
			typeof api?.setString === 'function'
				? api.setString
				: api?.default && typeof api.default.setString === 'function'
					? api.default.setString
					: null
		if (setFn) {
			setFn.call(api?.default ?? api, text)
			return true
		}
	} catch {}
	return false
}

function formatError(msg: string): string {
	const m = (msg || '').toLowerCase()
	if (m.includes('api key') || m.includes('401') || m.includes('403') || m.includes('invalid')) {
		return 'Invalid or missing API key. Paste it in Settings.'
	}
	return (msg || 'Chatbot failed').slice(0, 120)
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

// ---------- Chat panel (sessions on the right) ----------

function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
	const sessions = getSessionsStorage().use() ?? []
	const [activeId, setActiveId] = useState<string | null>(null)
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const [pending, setPending] = useState<ChatAttachment | null>(null)
	const [urlMode, setUrlMode] = useState(false)
	const [urlDraft, setUrlDraft] = useState('')

	const active = useMemo(
		() => sessions.find(s => s.id === activeId) ?? sessions[0] ?? null,
		[sessions, activeId],
	)

	const tryNativePicker = async (): Promise<boolean> => {
		// Attempt to use Discord's bundled pickers if present (image or document).
		const propsToTry = [
			'launchImageLibrary',
			'launchImageLibraryAsync',
			'pickImage',
			'showImagePicker',
			'openFile',
			'pickDocument',
		]
		for (const prop of propsToTry) {
			try {
				const [found] = lookupModule(withProps(prop))
				const mod: any = found as any
				const fn = mod?.[prop] ?? mod?.default?.[prop]
				if (typeof fn !== 'function') continue
				const res = await fn.call(mod?.default ?? mod, {
					mediaType: 'photo',
					quality: 0.8,
					selectionLimit: 1,
				})
				const asset =
					res?.assets?.[0] ?? res?.asset ?? (typeof res?.uri === 'string' ? res : null)
				if (!asset?.uri) continue
				const uri: string = asset.uri
				const filename: string = asset.fileName ?? asset.name ?? 'image.jpg'
				const mime: string = asset.mimeType ?? asset.type ?? 'image/jpeg'
				const downloaded = await fetch(uri).then(r => r.arrayBuffer())
				const isText =
					mime.startsWith('text/') ||
					/\.(txt|md|json|js|ts|py|html|css|xml|csv)$/i.test(filename)
				if (isText) {
					try {
						const decoder = new TextDecoder()
						setPending({ filename, mime, text: decoder.decode(downloaded).slice(0, 8000) })
					} catch {
						setPending({ filename, mime, base64: bytesToBase64(downloaded) })
					}
				} else {
					setPending({ filename, mime, base64: bytesToBase64(downloaded) })
				}
				showToast('File attached ✓', 'success')
				return true
			} catch {}
		}
		return false
	}

	const onUploadPressed = async () => {
		const picked = await tryNativePicker()
		if (!picked) {
			// No native picker in this build — ask for a URL they can paste
			setUrlMode(true)
			showToast('Paste an HTTPS file URL below', 'default')
		}
	}

	const attachUrl = async () => {
		const url = urlDraft.trim()
		if (!url) return
		if (!/^https?:\/\//i.test(url)) {
			showToast('Paste an https:// link', 'critical')
			return
		}
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0' },
			} as any)
			if (!res.ok) {
				showToast(`Download failed (${res.status})`, 'critical')
				return
			}
			const mime = (res.headers.get('content-type') as string) || 'application/octet-stream'
			const buf = await res.arrayBuffer()
			if (buf.byteLength > 5 * 1024 * 1024) {
				showToast('File too large (max ~5 MB)', 'critical')
				return
			}
			const filename = url.split('/').pop()?.split('?')[0] || 'file'
			const isText =
				mime.startsWith('text/') ||
				/\.(txt|md|json|js|ts|py|html|css|xml|csv)$/i.test(filename)
			if (isText) {
				try {
					const text = await res.clone().text().catch(() => '')
					setPending({ filename, mime, text: text.slice(0, 8000) })
				} catch {
					setPending({ filename, mime, base64: bytesToBase64(buf) })
				}
			} else {
				setPending({ filename, mime, base64: bytesToBase64(buf) })
			}
			setUrlDraft('')
			setUrlMode(false)
			showToast('File attached ✓', 'success')
		} catch {
			showToast('Could not download that URL', 'critical')
		}
	}

	const send = async () => {
		const text = draft.trim() || (pending ? 'Describe this attachment.' : '')
		if ((!text && !pending) || sending) return
		let session = active ?? newSession()
		setDraft('')
		setSending(true)

		const userMsg: ChatMessage = {
			role: 'user',
			content: pending ? `${text}\n📎 ${pending.filename}` : text,
			at: Date.now(),
		}
		const attachment = pending
		setPending(null)
		session = {
			...session,
			title: session.messages.length === 0 ? text.slice(0, 40) : session.title,
			updatedAt: Date.now(),
			messages: [...session.messages, userMsg].slice(-MAX_MSGS),
		}
		upsertSession(session)
		setActiveId(session.id)

		try {
			const settings = getSettings()
			const result = await askLlm(settings, text, attachment ?? undefined)
			const assistantMsg: ChatMessage = { role: 'assistant', content: result.text.trim(), at: Date.now() }
			const latest = getSessions().find(s => s.id === session.id) ?? session
			upsertSession({
				...latest,
				updatedAt: Date.now(),
				messages: [...latest.messages, assistantMsg].slice(-MAX_MSGS),
			})
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Chatbot failed'
			showToast(formatError(msg), 'critical')
			try {
				const latest = getSessions().find(s => s.id === session.id) ?? session
				upsertSession({
					...latest,
					updatedAt: Date.now(),
					messages: [
						...latest.messages,
						{ role: 'assistant', content: `Error: ${formatError(msg)}`, at: Date.now() },
					].slice(-MAX_MSGS),
				})
			} catch {}
		} finally {
			setSending(false)
		}
	}

	const downloadSession = (session: ChatSession) => {
		const lines: string[] = [
			`# ${session.title}`,
			`Exported: ${new Date().toISOString()}`,
			'',
		]
		for (const m of session.messages) {
			lines.push(m.role === 'user' ? `## You` : `## Hozy's Chatbot`)
			lines.push('')
			lines.push(m.content)
			lines.push('')
		}
		const text = lines.join('\n')
		const ok = copyToClipboard(text)
		showToast(ok ? 'Session copied as Markdown ✓' : 'Copy failed — select text manually', ok ? 'success' : 'critical')
	}

	return (
		<Modal visible={open} animationType="slide" transparent={false} onRequestClose={onClose}>
			<View style={styles.panel}>
				<View style={styles.panelHeader}>
					<TouchableOpacity onPress={onClose} style={styles.headerBtn}>
						<Design.Text variant="text-md/medium" style={styles.closeTxt}>
							Close ✕
						</Design.Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.headerBtn}
						onPress={() => {
							const s = newSession()
							upsertSession(s)
							setActiveId(s.id)
						}}
					>
						<Design.Text variant="text-md/medium" style={styles.closeTxt}>
							+ New
						</Design.Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.headerBtn}
						onPress={() => active && downloadSession(active)}
					>
						<Design.Text variant="text-md/medium" style={styles.closeTxt}>
							⬇ Download
						</Design.Text>
					</TouchableOpacity>
				</View>

				<View style={styles.panelBody}>
					<View style={{ flex: 1 }}>
						<ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
							{active && active.messages.length > 0 ? (
								active.messages.map((m, i) => (
									<View
										key={`${m.at}-${i}`}
										style={[styles.msgCard, m.role === 'user' ? styles.msgUser : styles.msgAssistant]}
									>
										<Design.Text variant="text-sm/medium" style={styles.msgRole}>
											{m.role === 'user' ? 'You' : "Hozy's Chatbot"}
										</Design.Text>
										<Design.Text variant="text-sm/normal" selectable style={styles.msgBody}>
											{m.content}
										</Design.Text>
									</View>
								))
							) : (
								<Design.Text variant="text-sm/normal" style={styles.emptyTxt}>
									Start chatting — ask anything (code, errors, ideas…).
								</Design.Text>
							)}
						</ScrollView>
						{urlMode ? (
							<View style={styles.urlRow}>
								<TextInput
									value={urlDraft}
									onChangeText={setUrlDraft}
									placeholder="Paste https:// file URL…"
									placeholderTextColor="#949ba4"
									autoCapitalize="none"
									autoCorrect={false}
									style={styles.urlInput}
								/>
								<TouchableOpacity style={styles.attachBtn} onPress={attachUrl}>
									<Design.Text variant="text-sm/medium" style={styles.sendTxt}>
										Attach
									</Design.Text>
								</TouchableOpacity>
								<TouchableOpacity style={styles.attachBtn} onPress={() => setUrlMode(false)}>
									<Design.Text variant="text-sm/medium" style={styles.sendTxt}>
										✕
									</Design.Text>
								</TouchableOpacity>
							</View>
						) : null}
						{pending ? (
							<View style={styles.chipRow}>
								<Design.Text variant="text-sm/medium" style={styles.chipTxt}>
									📎 {pending.filename}
								</Design.Text>
								<TouchableOpacity onPress={() => setPending(null)}>
									<Design.Text variant="text-sm/medium" style={styles.closeTxt}>
										Remove
									</Design.Text>
								</TouchableOpacity>
							</View>
						) : null}
						<View style={styles.inputRow}>
							<TouchableOpacity style={styles.attachBtn} onPress={onUploadPressed}>
								<Design.Text variant="text-md/medium" style={styles.sendTxt}>
									📎
								</Design.Text>
							</TouchableOpacity>
							<TextInput
								value={draft}
								onChangeText={setDraft}
								placeholder="Message or ask about the file…"
								placeholderTextColor="#949ba4"
								multiline
								style={styles.chatInput}
							/>
							<TouchableOpacity style={styles.sendBtn} onPress={send}>
								<Design.Text variant="text-md/medium" style={styles.sendTxt}>
									{sending ? '…' : '➤'}
								</Design.Text>
							</TouchableOpacity>
						</View>
					</View>

					<View style={styles.side}>
						<Design.Text variant="text-sm/medium" style={styles.sideTitle}>
							Sessions
						</Design.Text>
						<ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
							{sessions.map(s => (
								<View key={s.id}>
									<TouchableOpacity
										style={[styles.sessionItem, active?.id === s.id && styles.sessionActive]}
										onPress={() => setActiveId(s.id)}
									>
										<Design.Text variant="text-sm/medium" numberOfLines={1} style={styles.sessionTitle}>
											{s.title}
										</Design.Text>
										<Design.Text variant="text-sm/normal" style={styles.sessionMeta}>
											{new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} • {s.messages.length} msg
										</Design.Text>
									</TouchableOpacity>
									<TouchableOpacity onPress={() => deleteSession(s.id)}>
										<Design.Text variant="text-sm/normal" style={styles.deleteTxt}>
											Delete
										</Design.Text>
									</TouchableOpacity>
								</View>
							))}
							{sessions.length === 0 ? (
								<Design.Text variant="text-sm/normal" style={styles.sessionMeta}>
									No sessions yet
								</Design.Text>
							) : null}
						</ScrollView>
					</View>
				</View>
			</View>
		</Modal>
	)
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const [showKey, setShowKey] = useState(false)
	const [chatOpen, setChatOpen] = useState(false)

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
				<Design.TableRowGroup title="Chat">
					<Design.TableRow
						label="Open chat panel"
						subLabel="Talk here — sessions on the right"
						arrow
						onPress={() => setChatOpen(true)}
					/>
				</Design.TableRowGroup>

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
			<ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
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
	panel: { flex: 1, backgroundColor: '#1e1f22' },
	panelHeader: {
		flexDirection: 'row',
		padding: 12,
		borderBottomWidth: 1,
		borderBottomColor: '#2b2d31',
	},
	headerBtn: { paddingHorizontal: 12, paddingVertical: 6 },
	closeTxt: { color: '#5865f2' },
	panelBody: { flex: 1, flexDirection: 'row' },
	side: {
		width: 140,
		borderLeftWidth: 1,
		borderLeftColor: '#2b2d31',
		padding: 8,
	},
	sideTitle: { color: '#ffffff', marginBottom: 8 },
	sessionItem: {
		backgroundColor: '#2b2d31',
		borderRadius: 8,
		padding: 8,
		marginBottom: 6,
	},
	sessionActive: { borderWidth: 1, borderColor: '#5865f2' },
	sessionTitle: { color: '#ffffff' },
	sessionMeta: { color: '#949ba4', marginTop: 2 },
	deleteTxt: { color: '#f23f5e', marginBottom: 8, marginLeft: 4 },
	msgCard: {
		margin: 8,
		padding: 10,
		borderRadius: 8,
	},
	msgUser: { backgroundColor: '#35373c' },
	msgAssistant: { backgroundColor: '#1e1f22', borderWidth: 1, borderColor: '#2b2d31' },
	msgRole: { color: '#5865f2', marginBottom: 4 },
	msgBody: { color: '#dbdee1' },
	emptyTxt: { color: '#949ba4', padding: 16 },
	urlRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 4, alignItems: 'center' },
	urlInput: {
		flex: 1,
		backgroundColor: '#2b2d31',
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 8,
		color: '#ffffff',
		fontSize: 13,
		marginRight: 6,
	},
	chipRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 4 },
	chipTxt: { color: '#dbdee1', flex: 1 },
	attachBtn: { backgroundColor: '#35373c', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginRight: 6 },
	inputRow: { flexDirection: 'row', padding: 8, borderTopWidth: 1, borderTopColor: '#2b2d31' },
	chatInput: {
		flex: 1,
		backgroundColor: '#2b2d31',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		color: '#ffffff',
		fontSize: 14,
	},
	sendBtn: { backgroundColor: '#5865f2', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 },
	sendTxt: { color: '#ffffff' },
})
