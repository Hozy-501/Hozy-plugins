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
import { getImageAttachment, runOcr } from './ocr'
import { getSettings, getStorage, SettingsComponent } from './settings'

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
			console.error("[Hozy's Image OCR]", text)
		}
	}
}

function isOwnOcr(message: any): boolean {
	if (!message) return false
	if (message.loggingName === "Hozy's Image OCR") return true
	if (message.author?.username === "Hozy's Image OCR") return true
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
			showToast('hozy-ocr-copied', 'Text copied ✓', 'success')
			return true
		}
	} catch {}
	showToast('hozy-ocr-copy-fail', 'Could not copy — copy it from the message', 'critical')
	return false
}

function showOcrAlert(text: string) {
	try {
		AlertActionCreators.openAlert(
			'hozy-ocr-result',
			createElement(Design.AlertModal, {
				title: 'Extracted Text (Image OCR)',
				content: "Only you can see this. Translate it with Hozy's Translator.",
				extraContent: createElement(Design.Text, {
					variant: 'text-sm/medium',
					selectable: true,
					children: text,
				}),
				actions: createElement(Design.AlertActionButton, {
					text: 'Copy',
					variant: 'primary',
					onPress: () => {
						copyText(text)
						AlertActionCreators.dismissAlert('hozy-ocr-result')
					},
				}),
			}),
		)
	} catch (error) {
		console.error("[Hozy's Image OCR] alert failed:", error)
	}
}

// ---------- Error messages (English) ----------
function formatError(msg: string): string {
	const m = (msg || '').toLowerCase()

	if (m.includes('download failed') || m.includes('network')) {
		return (msg || 'Image download failed').slice(0, 120)
	}
	if (m.includes('empty') || m.includes('no text')) {
		return 'No text found in this image.'
	}
	if (m.includes('apikey') || m.includes('api key') || m.includes('401') || m.includes('403')) {
		return 'Invalid or missing OCR API key. Paste your key in settings.'
	}

	return (msg || 'OCR failed').slice(0, 120)
}

async function runExtract(message: any) {
	const channelId = String(message?.channel_id ?? message?.channelId ?? '')
	const image = getImageAttachment(message)
	if (!image) {
		showToast('hozy-ocr-not-image', 'Not an image message.', 'critical')
		return
	}

	const settings = getSettings()
	const effectiveLang = settings.language || 'all'
	const key = cacheKey(String(message?.id ?? ''), image.url, effectiveLang)
	const cached = getCached(key)

	if (cached && cached.text && cached.text.trim()) {
		const text = cached.text.trim()
		const header = `**Extracted Text (from cache)**`
		const body = `${header}\n${text}`

		showToast('hozy-ocr-cached', 'Loaded from cache ✓', 'success')

		if (channelId) {
			sendLocalMessage(channelId, body, [
				{
					type: 'rich',
					title: 'Extracted Text (cached)',
					description: text,
					color: 0x5865f2,
					footer: {
						text: `${cached.providerUsed} • only you can see this — use Hozy's Translator to translate it`,
					},
				},
			])
		}
		if (settings.showPopup ?? true) showOcrAlert(text)
		return
	}

	showToast('hozy-ocr-working', 'Reading image…')

	try {
		const result = await runOcr(image, settings)
		const text = result.text.trim()
		if (!text) {
			showToast('hozy-ocr-empty', 'No text found in this image.', 'critical')
			return
		}

		setCached(key, {
			text,
			language: effectiveLang,
			providerUsed: result.providerUsed,
			at: Date.now(),
		})

		const header = `**Extracted Text**`
		const body = `${header}\n${text}`

		if (!channelId) {
			showToast('hozy-ocr-result', text, 'success')
			if (settings.showPopup ?? true) showOcrAlert(text)
			return
		}

		const sent = sendLocalMessage(channelId, body, [
			{
				type: 'rich',
				title: 'Extracted Text',
				description: text,
				color: 0x5865f2,
				footer: {
					text: `${result.providerUsed} • only you can see this — use Hozy's Translator to translate it`,
				},
			},
		])

		if (settings.showPopup ?? true) showOcrAlert(text)

		if (!sent) {
			showToast('hozy-ocr-result', text, 'success')
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'OCR failed'
		showToast('hozy-ocr-error', formatError(msg), 'critical')
	}
}

function alreadyHasExtract(node: unknown): boolean {
	if (node == null) return false
	if (Array.isArray(node)) return node.some(alreadyHasExtract)
	if (!isValidElement(node)) return false
	const props = node.props as { label?: string; children?: unknown }
	if (props?.label === 'Extract Text' || (node as any).key === 'hozy-extract-text')
		return true
	return alreadyHasExtract(props?.children)
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

function makeExtractRow(message: any) {
	const iconSource =
		getAssetIdByName('TextIcon') ??
		getAssetIdByName('ImageIcon') ??
		getAssetIdByName('ScanIcon')
	const Row = Design.ActionSheetRow ?? Design.TableRow
	const Icon = Design.TableRow?.Icon
	if (typeof Row !== 'function') return null

	return createElement(Row, {
		key: 'hozy-extract-text',
		label: 'Extract Text',
		subLabel: 'Visible only to you',
		icon:
			Icon && iconSource != null
				? createElement(Icon, { source: iconSource })
				: undefined,
		onPress: () => {
			ActionSheetActionCreators.hideActionSheet()
			void runExtract(message)
		},
	})
}

function injectExtractAction(sheetProps: any, res: any) {
	if (!res) return res

	const message =
		sheetProps?.message ??
		sheetProps?.messageRecord ??
		sheetProps?.item?.message ??
		pendingMessage
	if (!message || isOwnOcr(message)) return res

	// Only inject on image messages (attachments / embeds)
	if (!getImageAttachment(message)) return res

	if (alreadyHasExtract(res)) return res

	const row = makeExtractRow(message)
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
						return injectExtractAction(args[0], res)
					} catch (error) {
						console.error("[Hozy's Image OCR] Failed to inject action:", error)
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
		logger.log("Hozy's Image OCR started.")
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
							injectExtractAction({ message: pendingMessage }, element) ??
							element
						)
					} catch (error) {
						console.error(
							"[Hozy's Image OCR] Failed to inject sheet row:",
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
					if (!getImageAttachment(pendingMessage)) return args
					if (isOwnOcr(pendingMessage)) return args
					const items = Array.isArray(props.items) ? [...props.items] : []
					const flat = items.flat()
					if (flat.some((item: any) => item?.label === 'Extract Text')) return args
					const message = pendingMessage
					items.unshift({
						label: 'Extract Text',
						action: () => {
							void runExtract(message)
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
		logger.log("Hozy's Image OCR stopped.")
	},
})
