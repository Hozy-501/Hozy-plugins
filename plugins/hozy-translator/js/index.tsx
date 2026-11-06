import { getAssetIdByName } from '@valenced/assets'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { afterJSX, beforeJSX } from '@valenced/react/jsx-runtime'
import { Children, cloneElement, createElement, isValidElement } from 'react'
import { getLanguageName } from './languages'
import { sendLocalMessage } from './local-message'
import { getSettings, getStorage, SettingsComponent } from './settings'
import { getEngineLabel, translateText } from './translator'

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
			console.error("[Hozy's Translator]", text)
		}
	}
}

function getTranslatableText(message: any): string {
	if (typeof message?.content === 'string' && message.content.trim())
		return message.content
	if (!Array.isArray(message?.embeds)) return ''

	const parts: string[] = []
	for (const embed of message.embeds) {
		if (embed?.title) parts.push(String(embed.title))
		if (embed?.description) parts.push(String(embed.description))
		if (Array.isArray(embed?.fields)) {
			for (const field of embed.fields) {
				if (field?.name) parts.push(String(field.name))
				if (field?.value) parts.push(String(field.value))
			}
		}
	}
	return parts.join('\n').trim()
}

async function runTranslate(message: any) {
	const channelId = String(message?.channel_id ?? message?.channelId ?? '')
	const text = getTranslatableText(message)
	if (!text) {
		showToast('hozy-translator-empty', 'No text to translate.', 'critical')
		return
	}

	const settings = getSettings()
	showToast('hozy-translator-working', 'Translating…')

	try {
		const result = await translateText(
			text,
			settings.service,
			settings.fromLanguage,
			settings.toLanguage,
		)
		const from = result.detectedSource || settings.fromLanguage
		const header =
			from && from !== 'auto'
				? `**${getLanguageName(from)} → ${getLanguageName(settings.toLanguage)}**`
				: `**Translated to ${getLanguageName(settings.toLanguage)}**`
		const body = `${header}\n${result.translatedText}`

		if (!channelId) {
			showToast('hozy-translator-result', result.translatedText, 'success')
			return
		}

		sendLocalMessage(channelId, body, [
			{
				type: 'rich',
				title: 'Translation',
				description: result.translatedText,
				color: 0x5865f2,
				footer: {
					text: `${getEngineLabel(result.serviceUsed)} • only you can see this`,
				},
			},
		])
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Translation failed'
		showToast('hozy-translator-error', msg, 'critical')
	}
}

function alreadyHasTranslate(node: unknown): boolean {
	if (node == null) return false
	if (Array.isArray(node)) return node.some(alreadyHasTranslate)
	if (!isValidElement(node)) return false
	const props = node.props as { label?: string; children?: unknown }
	if (props?.label === 'Translate' || (node as any).key === 'hozy-translate')
		return true
	return alreadyHasTranslate(props?.children)
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

function makeTranslateRow(message: any) {
	const iconSource =
		getAssetIdByName('TranslateIcon') ?? getAssetIdByName('LanguageIcon')
	const Row = Design.ActionSheetRow ?? Design.TableRow
	const Icon = Design.TableRow?.Icon
	if (typeof Row !== 'function') return null

	return createElement(Row, {
		key: 'hozy-translate',
		label: 'Translate',
		subLabel: 'Visible only to you',
		icon:
			Icon && iconSource != null
				? createElement(Icon, { source: iconSource })
				: undefined,
		onPress: () => {
			ActionSheetActionCreators.hideActionSheet()
			void runTranslate(message)
		},
	})
}

function injectTranslateAction(sheetProps: any, res: any) {
	if (!res) return res

	const message =
		sheetProps?.message ??
		sheetProps?.messageRecord ??
		sheetProps?.item?.message ??
		pendingMessage
	if (
		!message ||
		message.loggingName === "Hozy's Translator" ||
		message.author?.username === "Hozy's Translator"
	)
		return res
	if (alreadyHasTranslate(res)) return res

	const row = makeTranslateRow(message)
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
						return injectTranslateAction(args[0], res)
					} catch (error) {
						console.error("[Hozy's Translator] Failed to inject action:", error)
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
		logger.log("Hozy's Translator started.")
		void getStorage().get()

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
							injectTranslateAction({ message: pendingMessage }, element) ??
							element
						)
					} catch (error) {
						console.error(
							"[Hozy's Translator] Failed to inject sheet row:",
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
					const items = Array.isArray(props.items) ? [...props.items] : []
					const flat = items.flat()
					if (flat.some((item: any) => item?.label === 'Translate')) return args
					const message = pendingMessage
					items.unshift({
						label: 'Translate',
						action: () => {
							void runTranslate(message)
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
		logger.log("Hozy's Translator stopped.")
	},
})
