import { getAssetIdByName } from '@valenced/assets'
import {
	ActionSheetActionCreators,
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before, instead } from '@valenced/patcher'
import { afterJSX, beforeJSX } from '@valenced/react/jsx-runtime'
import { Children, cloneElement, createElement, isValidElement } from 'react'
import { cacheKey, getCached, getCacheStorage, setCached } from './cache'
import { sendLocalMessage } from './local-message'
import { getSettings, getStorage, SettingsComponent } from './settings'
import { getVoiceAudio, transcribeAudio } from './transcriber'

const patched = new WeakSet<object>()
const SHEET_KEY = /Message(LongPress)?ActionSheet|MessageContextMenu/i
const MESSAGE_ACTION =
	/^(Reply|Forward|Edit Message|Edit|Delete Message|Delete|Copy Text|Copy Message Link|Copy Message|Pin Message|Unpin Message|Pin|Unpin|Mark Unread|React|Add Reaction|Mention|Speak Message|Apps)$/i

let pendingMessage: any

function showToast(
	key: string,
	text: string,
	variant: 'default' | 'success' | 'critical' = 'default',
) {
	try {
		ToastActionCreators.open(key, { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key, content: text })
		} catch {
			console.error("[Hozy's Voice Transcriber]", text)
		}
	}
}

function isOwnTranscription(message: any): boolean {
	if (!message) return false
	if (message.loggingName === "Hozy's Voice Transcriber") return true
	if (message.author?.username === "Hozy's Voice Transcriber") return true
	return false
}

// ---------- Copy to clipboard (same approach as Hozy Token) ----------
function copyText(text: string): boolean {
	try {
		const [clip] = lookupModule(withProps('setString', 'getString'))
		const api = clip as any
		const setFn =
			typeof api?.setString === 'function'
				? api.setString
				: api?.default && typeof api.default.setString === 'function'
					? api.default.setString
					: null
		if (setFn) {
			setFn.call(api?.default ?? api, text)
			showToast('hozy-voice-copied', 'تم نسخ النص ✓', 'success')
			return true
		}
	} catch {}
	showToast('hozy-voice-copy-fail', 'تعذر النسخ — انسخ النص من الرسالة', 'critical')
	return false
}

function showTranscriptAlert(text: string) {
	try {
		AlertActionCreators.openAlert(
			'hozy-voice-transcript',
			createElement(Design.AlertModal, {
				title: 'تفريغ صوتي (Voice Transcription)',
				content: 'فقط أنت تراه. يمكنك ترجمته بـ Hozy\'s Translator.',
				extraContent: createElement(Design.Text, {
					variant: 'text-sm/medium',
					selectable: true,
					children: text,
				}),
				actions: createElement(Design.AlertActionButton, {
					text: 'Copy / نسخ',
					variant: 'primary',
					onPress: () => {
						copyText(text)
						AlertActionCreators.dismissAlert('hozy-voice-transcript')
					},
				}),
			}),
		)
	} catch (error) {
		console.error("[Hozy's Voice Transcriber] alert failed:", error)
		// fallback: local message already contains the text
	}
}

// ---------- Arabic error messages ----------
function toArabicError(msg: string): string {
	const m = (msg || '').toLowerCase()

	if (m.includes('api key') || m.includes('401') || m.includes('403') || m.includes('invalid')) {
		return 'المفتاح غير صحيح أو مفقود. الصق مفتاح Groq في إعدادات البلقن.'
	}
	if (m.includes('empty') || m.includes('returned')) {
		return 'الخدمة رجعت نص فارغ. جرب مرة ثانية.'
	}
	if (m.includes('download') || m.includes('network') || m.includes('fetch')) {
		return 'فشل تحميل الصوت أو الاتصال. تحقق من الإنترنت.'
	}
	if (m.includes('failed (5') || m.includes('503') || m.includes('queue is full') || m.includes('rate')) {
		return 'الخدمة المجانية مشغولة الآن. انتظر دقيقة أو أضف مفتاح Groq.'
	}
	if (m.includes('custom endpoint')) {
		return 'رابط الـ endpoint المخصص فارغ في الإعدادات.'
	}

	// Unknown — keep a short Arabic lead + original (truncated)
	const short = (msg || '').slice(0, 80)
	return short ? `حدث خطأ: ${short}` : 'حدث خطأ غير معروف.'
}

async function runTranscribe(message: any) {
	const channelId = String(message?.channel_id ?? message?.channelId ?? '')
	const audio = getVoiceAudio(message)
	if (!audio) {
		showToast('hozy-voice-not-voice', 'هذه ليست رسالة صوتية.', 'critical')
		return
	}

	const settings = getSettings()
	const key = cacheKey(String(message?.id ?? ''), audio.url)
	const cached = getCached(key)

	if (cached && cached.text && cached.text.trim()) {
		const transcript = cached.text.trim()
		const langPart = cached.language ? ` • lang: ${cached.language}` : ''
		const header = `**Transcription${langPart} (from cache)**`
		const body = `${header}\n${transcript}`

		showToast('hozy-voice-cached', 'تم من الذاكرة ✓', 'success')

		if (channelId) {
			sendLocalMessage(channelId, body, [
				{
					type: 'rich',
					title: 'Voice Transcription (cached)',
					description: transcript,
					color: 0x5865f2,
					footer: {
						text: `${cached.providerUsed} • only you can see this — use Hozy's Translator to translate it`,
					},
				},
			])
		}
		showTranscriptAlert(transcript)
		return
	}

	showToast('hozy-voice-working', 'جاري التفريغ…')

	try {
		const result = await transcribeAudio(audio, settings)
		const transcript = result.text.trim()
		if (!transcript) {
			showToast('hozy-voice-empty', 'الخدمة رجعت نص فارغ. جرب مرة ثانية.', 'critical')
			return
		}

		setCached(key, {
			text: transcript,
			language: result.language,
			providerUsed: result.providerUsed,
			at: Date.now(),
		})

		const langPart = result.language
			? ` • lang: ${result.language}`
			: ''
		const header = `**Transcription${langPart}**`
		const body = `${header}\n${transcript}`

		if (!channelId) {
			showToast('hozy-voice-result', transcript, 'success')
			showTranscriptAlert(transcript)
			return
		}

		const sent = sendLocalMessage(channelId, body, [
			{
				type: 'rich',
				title: 'Voice Transcription',
				description: transcript,
				color: 0x5865f2,
				footer: {
					text: `${result.providerUsed} • only you can see this — use Hozy's Translator to translate it`,
				},
			},
		])

		showTranscriptAlert(transcript)

		if (!sent) {
			showToast('hozy-voice-result', transcript, 'success')
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Transcription failed'
		showToast('hozy-voice-error', toArabicError(msg), 'critical')
	}
}

function alreadyHasTranscribe(node: unknown): boolean {
	if (node == null) return false
	if (Array.isArray(node)) return node.some(alreadyHasTranscribe)
	if (!isValidElement(node)) return false
	const props = node.props as { label?: string; children?: unknown }
	if (props?.label === 'Transcribe' || (node as any).key === 'hozy-transcribe')
		return true
	return alreadyHasTranscribe(props?.children)
}

function isMessageActionList(list: any[]) {
	return list.some(child => {
		const label = isValidElement(child)
			? (child.props as any)?.label
			: child?.label
		return typeof label === 'string' && MESSAGE_ACTION.test(label)
	})
}

function findRowList(node: unknown, depth = 0): any[] | undefined {
	if (node == null || depth > 18) return
	if (Array.isArray(node)) {
		if (
			isMessageActionList(node) ||
			node.some(
				child => isValidElement(child) && (child.props as any)?.label != null,
			)
		) {
			if (isMessageActionList(node) || depth > 0) return node
		}
		for (const child of node) {
			const found = findRowList(child, depth + 1)
			if (found) return found
		}
		return
	}
	if (isValidElement(node))
		return findRowList((node.props as any)?.children, depth + 1)
	if (typeof node === 'object') {
		for (const value of Object.values(node as Record<string, unknown>)) {
			if (value === node) continue
			const found = findRowList(value, depth + 1)
			if (found) return found
		}
	}
}

function makeTranscribeRow(message: any) {
	const iconSource =
		getAssetIdByName('VoiceIcon') ??
		getAssetIdByName('MicIcon') ??
		getAssetIdByName('WaveformIcon')
	const Row = Design.ActionSheetRow ?? Design.TableRow
	const Icon = Design.TableRow?.Icon
	if (typeof Row !== 'function') return null

	return createElement(Row, {
		key: 'hozy-transcribe',
		label: 'Transcribe',
		subLabel: 'Visible only to you',
		icon:
			Icon && iconSource != null
				? createElement(Icon, { source: iconSource })
				: undefined,
		onPress: () => {
			ActionSheetActionCreators.hideActionSheet()
			void runTranscribe(message)
		},
	})
}

function injectTranscribeAction(sheetProps: any, res: any) {
	if (!res) return res

	const message =
		sheetProps?.message ??
		sheetProps?.messageRecord ??
		sheetProps?.item?.message ??
		pendingMessage
	if (!message || isOwnTranscription(message)) return res

	// Only inject on voice messages (or audio attachments)
	if (!getVoiceAudio(message)) return res

	if (alreadyHasTranscribe(res)) return res

	const row = makeTranscribeRow(message)
	if (!row) return res
	const list = findRowList(res)
	if (list) {
		try {
			list.splice(Math.min(1, list.length), 0, row)
			return res
		} catch {}
	}

	if (isValidElement(res)) {
		const children = Children.toArray((res.props as any)?.children)
		return cloneElement(res, {
			...(res.props as object),
			children: [children[0], row, ...children.slice(1)].filter(Boolean),
		} as any)
	}

	return res
}

function patchComponent(
	exports: any,
	cleanup: (...fns: Array<() => any>) => void,
) {
	const parent =
		typeof exports === 'function'
			? { default: exports }
			: exports && typeof exports === 'object'
				? exports
				: null
	if (!parent) return

	const targets: Array<[object, string]> = []
	if (typeof parent.default === 'function') targets.push([parent, 'default'])
	if (parent.default?.type && typeof parent.default.type === 'function') {
		targets.push([parent.default, 'type'])
	}
	if (parent.default?.render && typeof parent.default.render === 'function') {
		targets.push([parent.default, 'render'])
	}
	if (typeof parent.render === 'function') targets.push([parent, 'render'])

	for (const name of [
		'MessageLongPressActionSheet',
		'MessageActionSheet',
		'MessageContextMenu',
	]) {
		if (typeof parent[name] === 'function') targets.push([parent, name])
	}

	for (const [object, key] of targets) {
		const fn = (object as any)[key]
		if (!fn || patched.has(fn)) continue
		patched.add(fn)

		cleanup(
			instead(
				object as any,
				key,
				function (this: unknown, args: any[], original: (...a: any[]) => any) {
					const res = original.apply(this, args)
					try {
						return injectTranscribeAction(args[0], res)
					} catch (error) {
						console.error("[Hozy's Voice Transcriber] Failed to inject action:", error)
						return res
					}
				},
			),
		)
	}
}

function looksLikeMessageSheet(key: unknown, props: any) {
	if (props?.message || props?.messageRecord) return true
	return typeof key === 'string' && SHEET_KEY.test(key)
}

function rememberMessage(key: unknown, props: any) {
	if (looksLikeMessageSheet(key, props)) {
		pendingMessage =
			props?.message ?? props?.messageRecord ?? props?.item?.message
		return
	}
	pendingMessage = undefined
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log("Hozy's Voice Transcriber started.")
		void getStorage().get()
		void getCacheStorage().get()

		if (typeof ActionSheetActionCreators?.openLazy === 'function') {
			cleanup(
				instead(ActionSheetActionCreators, 'openLazy', (args, original) => {
					const [sheet, key, props] = args as [
						Promise<any>,
						string,
						any,
						...unknown[],
					]
					rememberMessage(key, props)

					if (
						looksLikeMessageSheet(key, props) &&
						sheet &&
						typeof (sheet as any).then === 'function'
					) {
						return Promise.resolve(sheet).then(mod => {
							patchComponent(mod, cleanup)
							const next = [...args]
							next[0] = Promise.resolve(mod)
							return original(...(next as Parameters<typeof original>))
						})
					}

					return original(...args)
				}),
			)
		}

		const names = [
			'MessageLongPressActionSheet',
			'MessageActionSheet',
			'MessageContextMenu',
		]
		for (const name of names) {
			const [existing] = lookupModule(withName(name))
			if (existing) patchComponent(existing, cleanup)
			cleanup(
				waitForModules(withName(name), exports => {
					patchComponent(exports, cleanup)
				}),
			)
		}

		const Sheet = Design.ActionSheet ?? Design.BottomSheet
		if (typeof Sheet === 'function') {
			cleanup(
				afterJSX(Sheet, element => {
					if (!pendingMessage) return element
					try {
						return (
							injectTranscribeAction({ message: pendingMessage }, element) ??
							element
						)
					} catch (error) {
						console.error(
							"[Hozy's Voice Transcriber] Failed to inject sheet row:",
							error,
						)
						return element
					}
				}),
			)
		}

		if (typeof Design.ContextMenu === 'function') {
			cleanup(
				beforeJSX(Design.ContextMenu, args => {
					const [type, props, key] = args
					if (!pendingMessage || !props?.items) return args
					if (!getVoiceAudio(pendingMessage)) return args
					if (isOwnTranscription(pendingMessage)) return args
					const items = Array.isArray(props.items) ? [...props.items] : []
					const flat = items.flat()
					if (flat.some((item: any) => item?.label === 'Transcribe')) return args
					const message = pendingMessage
					items.unshift({
						label: 'Transcribe',
						action: () => {
							void runTranscribe(message)
						},
					})
					return [type, { ...props, items }, key]
				}),
			)
		}

		if (typeof ActionSheetActionCreators?.hideActionSheet === 'function') {
			cleanup(
				before(ActionSheetActionCreators, 'hideActionSheet', args => {
					pendingMessage = undefined
					return args
				}),
			)
		}

		if (typeof ActionSheetActionCreators?.hideAllActionSheets === 'function') {
			cleanup(
				before(ActionSheetActionCreators, 'hideAllActionSheets', args => {
					pendingMessage = undefined
					return args
				}),
			)
		}
	},
	stop({ logger }) {
		pendingMessage = undefined
		logger.log("Hozy's Voice Transcriber stopped.")
	},
})
