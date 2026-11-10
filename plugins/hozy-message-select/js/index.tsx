import { getAssetIdByName } from '@valenced/assets'
import {
	ActionSheetActionCreators,
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { onFluxEventDispatched } from '@valenced/discord/flux'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { Children, cloneElement, createElement, isValidElement } from 'react'
import { getSettings, getStorage, SettingsComponent } from './settings'

type ToastVariant = 'default' | 'success' | 'critical'

interface SelectedMessage {
	id: string
	channelId: string
	author: string
	preview: string
}

interface DeleteResult {
	ok: boolean
	missing?: boolean
	retryAfter?: number
	status?: number
	error?: unknown
}

const SHEET_KEY = /Message(LongPress)?ActionSheet|MessageContextMenu/i
const ROW_KEY_PREFIX = 'hozy-select-'
const ROW_LABELS =
	/^(Select message|Deselect message|Delete \d+ selected|Clear selection)$/
const NAMES = [
	'MessageLongPressActionSheet',
	'MessageActionSheet',
	'MessageContextMenu',
]
const MAX_SELECTION = 100
const CONFIRM_KEY = 'hozy-message-select-confirm'
const TOAST_KEY = 'hozy-message-select'

const selections = new Map<string, Map<string, SelectedMessage>>()
const patchedFns = new Set<object>()

let pendingMessage: any
let confirmTimer: ReturnType<typeof setTimeout> | undefined
let deleting = false
let stopped = false
let deleteGeneration = 0
let restApiCache: any
let messageActionsCache: any

function showToast(text: string, variant: ToastVariant = 'default') {
	try {
		ToastActionCreators.open(TOAST_KEY, { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key: TOAST_KEY, content: text })
		} catch {
			console.error("[Hozy's Message Select]", text)
		}
	}
}

function hideSheet() {
	try {
		ActionSheetActionCreators.hideActionSheet()
	} catch {}
}

function channelIdOf(message: any): string {
	const id =
		message?.channel_id ?? message?.channelId ?? message?.channel?.id
	return id ? String(id) : ''
}

function messageIdOf(message: any): string {
	const id = message?.id ?? message?.messageId
	return id ? String(id) : ''
}

function authorNameOf(message: any): string {
	const author = message?.author
	const name =
		author?.globalName ??
		author?.global_name ??
		author?.displayName ??
		author?.display_name ??
		author?.username ??
		author?.name ??
		'Unknown'
	return String(name)
}

function previewOf(message: any): string {
	const content =
		typeof message?.content === 'string' ? message.content.trim() : ''
	if (content) return content.replace(/\s+/g, ' ').slice(0, 90)

	const attachments = Array.isArray(message?.attachments)
		? message.attachments
		: []
	if (attachments.length > 0) {
		const first = attachments[0]
		const name = first?.filename ?? first?.name ?? 'attachment'
		return `📎 ${String(name)}`.slice(0, 90)
	}

	const embeds = Array.isArray(message?.embeds) ? message.embeds : []
	if (embeds.length > 0) {
		const embed = embeds[0]
		const title = embed?.title ?? embed?.description ?? 'Embed'
		return `🔗 ${String(title)}`.slice(0, 90)
	}

	if (
		message?.sticker_items?.length ||
		message?.stickerItems?.length ||
		message?.sticker
	) {
		return '🏷 Sticker'
	}

	return 'Message'
}

function countSelected(channelId: string): number {
	return selections.get(channelId)?.size ?? 0
}

function isSelected(channelId: string, messageId: string): boolean {
	return selections.get(channelId)?.has(messageId) ?? false
}

function toggleSelection(message: any) {
	const channelId = channelIdOf(message)
	const messageId = messageIdOf(message)
	if (!channelId || !messageId) {
		showToast('Could not read this message.', 'critical')
		return
	}

	let map = selections.get(channelId)
	if (!map) {
		map = new Map()
		selections.set(channelId, map)
	}

	if (map.has(messageId)) {
		map.delete(messageId)
		if (map.size === 0) selections.delete(channelId)
		showToast(`Deselected · ${map.size} selected`)
		return
	}

	if (map.size >= MAX_SELECTION) {
		showToast(`Selection limit is ${MAX_SELECTION} messages.`, 'critical')
		return
	}

	map.set(messageId, {
		id: messageId,
		channelId,
		author: authorNameOf(message),
		preview: previewOf(message),
	})
	showToast(`Selected · ${map.size} selected`, 'success')
}

function clearChannelSelection(channelId: string) {
	selections.delete(channelId)
	showToast('Selection cleared.')
}

function removeSelection(channelId: string | undefined, messageId: string) {
	if (channelId) {
		const map = selections.get(channelId)
		if (!map) return
		map.delete(messageId)
		if (map.size === 0) selections.delete(channelId)
		return
	}

	for (const [id, map] of selections) {
		map.delete(messageId)
		if (map.size === 0) selections.delete(id)
	}
}

function assetId(...names: string[]): number | undefined {
	for (const name of names) {
		try {
			const id = getAssetIdByName(name)
			if (id != null) return id
		} catch {}
	}
	return undefined
}

function makeRow(
	key: string,
	label: string,
	subLabel: string | undefined,
	iconNames: string[],
	onPress: () => void,
	danger = false,
): any | null {
	const Row: any = Design.ActionSheetRow ?? Design.TableRow
	const Icon: any =
		(Design.TableRow as any)?.Icon ?? (Design.ActionSheetRow as any)?.Icon
	if (typeof Row !== 'function') return null

	const source = assetId(...iconNames)
	return createElement(Row, {
		key,
		label,
		subLabel,
		variant: danger ? 'danger' : undefined,
		icon:
			Icon && source != null
				? createElement(Icon, {
						source,
						variant: danger ? 'danger' : undefined,
					})
				: undefined,
		onPress,
	})
}

function makeSelectionRows(message: any): any[] {
	const channelId = channelIdOf(message)
	const messageId = messageIdOf(message)
	if (!channelId || !messageId) return []

	const count = countSelected(channelId)
	const selected = isSelected(channelId, messageId)
	const rows: any[] = []

	const toggle = makeRow(
		'hozy-select-toggle',
		selected ? 'Deselect message' : 'Select message',
		count > 0
			? `${count} selected in this channel`
			: 'Select multiple, then delete together',
		selected
			? ['CheckmarkIcon', 'CheckIcon', 'SelectIcon']
			: ['SelectIcon', 'CheckmarkIcon', 'CheckIcon'],
		() => {
			hideSheet()
			toggleSelection(message)
		},
	)
	if (toggle) rows.push(toggle)

	if (count > 0) {
		const remove = makeRow(
			'hozy-select-delete',
			`Delete ${count} selected`,
			'Permanently deletes for everyone',
			['TrashIcon', 'DeleteIcon'],
			() => {
				hideSheet()
				scheduleConfirm(channelId)
			},
			true,
		)
		if (remove) rows.push(remove)

		const clear = makeRow(
			'hozy-select-clear',
			'Clear selection',
			`${count} selected`,
			['XIcon', 'CloseIcon', 'TrashIcon'],
			() => {
				hideSheet()
				clearChannelSelection(channelId)
			},
		)
		if (clear) rows.push(clear)
	}

	return rows
}

function isRowList(list: any[]): boolean {
	return list.some(child => {
		if (!isValidElement(child)) return false
		const props = child.props as { label?: unknown }
		return typeof props?.label === 'string'
	})
}

function findRowList(node: unknown, depth = 0): any[] | undefined {
	if (node == null || depth > 18) return
	if (Array.isArray(node)) {
		if (isRowList(node)) return node
		for (const child of node) {
			const found = findRowList(child, depth + 1)
			if (found) return found
		}
		return
	}
	if (isValidElement(node)) {
		return findRowList((node.props as any)?.children, depth + 1)
	}
	if (typeof node === 'object') {
		for (const value of Object.values(node as Record<string, unknown>)) {
			if (value === node) continue
			const found = findRowList(value, depth + 1)
			if (found) return found
		}
	}
}

function alreadyHasRows(node: unknown, depth = 0): boolean {
	if (node == null || depth > 20) return false
	if (Array.isArray(node)) {
		return node.some(child => alreadyHasRows(child, depth + 1))
	}
	if (!isValidElement(node)) return false
	const props = node.props as { label?: unknown; children?: unknown }
	const key = (node as any).key
	if (typeof key === 'string' && key.startsWith(ROW_KEY_PREFIX)) return true
	if (typeof props?.label === 'string' && ROW_LABELS.test(props.label)) {
		return true
	}
	return alreadyHasRows(props?.children, depth + 1)
}

function injectRows(sheetProps: any, res: any) {
	if (!res) return res

	const message =
		sheetProps?.message ??
		sheetProps?.messageRecord ??
		sheetProps?.item?.message ??
		pendingMessage
	if (!message) return res
	if (alreadyHasRows(res)) return res

	const rows = makeSelectionRows(message)
	if (rows.length === 0) return res

	const list = findRowList(res)
	if (list) {
		try {
			list.splice(Math.min(1, list.length), 0, ...rows)
			return res
		} catch {}
	}

	if (isValidElement(res)) {
		const children = Children.toArray((res.props as any)?.children)
		return cloneElement(res, {
			...(res.props as object),
			children: [...rows, ...children],
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

	for (const name of NAMES) {
		if (typeof parent[name] === 'function') targets.push([parent, name])
	}

	for (const [object, key] of targets) {
		const fn = (object as any)[key]
		if (!fn || patchedFns.has(fn)) continue
		patchedFns.add(fn)

		const unpatch = instead(
			object as any,
			key,
			function (this: unknown, args: any[], original: (...a: any[]) => any) {
				const res = original.apply(this, args)
				try {
					return injectRows(args[0], res)
				} catch (error) {
					console.error(
						"[Hozy's Message Select] Failed to inject actions:",
						error,
					)
					return res
				}
			},
		)

		cleanup(() => {
			patchedFns.delete(fn)
			try {
				unpatch()
			} catch {}
		})
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

function pickApi(found: any, keys: string[]): any {
	const candidates = [found, found?.default]
	for (const candidate of candidates) {
		if (
			!candidate ||
			(typeof candidate !== 'object' && typeof candidate !== 'function')
		) {
			continue
		}
		if (keys.some(key => typeof candidate[key] === 'function')) {
			return candidate
		}
	}
	return undefined
}

function getRestApi(): any {
	if (restApiCache) return restApiCache

	const attempts: Array<() => any> = [
		() => lookupModule(withProps('del', 'get', 'post', 'patch'))[0],
		() => lookupModule(withProps('delete', 'get', 'post'))[0],
		() => lookupModule(withProps('del', 'get'))[0],
	]

	for (const attempt of attempts) {
		try {
			const api = pickApi(attempt(), ['del', 'delete'])
			if (api) {
				restApiCache = api
				return api
			}
		} catch {}
	}

	return undefined
}

function getMessageActions(): any {
	if (messageActionsCache) return messageActionsCache
	try {
		const api = pickApi(
			lookupModule(withProps('deleteMessage', 'startEditMessage'))[0],
			['deleteMessage'],
		)
		if (api) messageActionsCache = api
	} catch {}
	return messageActionsCache
}

function retryAfterOf(error: any): number {
	const raw =
		error?.body?.retry_after ??
		error?.retry_after ??
		error?.retryAfter ??
		error?.headers?.['retry-after'] ??
		error?.headers?.['Retry-After'] ??
		error?.response?.headers?.['retry-after'] ??
		1
	const seconds = Number(raw)
	if (!Number.isFinite(seconds) || seconds <= 0) return 1000
	const ms = seconds > 100 ? seconds : seconds * 1000
	return Math.max(500, Math.min(ms + 250, 60000))
}

function sleep(ms: number) {
	return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function deleteOne(
	channelId: string,
	messageId: string,
): Promise<DeleteResult> {
	const rest = getRestApi()
	if (rest) {
		try {
			const del =
				typeof rest.del === 'function' ? rest.del : rest.delete
			const response = await del.call(rest, {
				url: `/channels/${channelId}/messages/${messageId}`,
			})
			const status = Number(response?.status ?? 0)
			if (!status || status === 200 || status === 204) {
				return { ok: true }
			}
			if (status === 404) return { ok: true, missing: true, status }
			if (status === 429) {
				return { ok: false, retryAfter: retryAfterOf(response), status }
			}
			if (status === 403) {
				return { ok: false, status, error: response }
			}
			return { ok: true }
		} catch (error: any) {
			const status = Number(
				error?.status ??
					error?.statusCode ??
					error?.response?.status ??
					0,
			)
			if (status === 404 || error?.body?.code === 10008) {
				return { ok: true, missing: true, status }
			}
			if (status === 429) {
				return { ok: false, retryAfter: retryAfterOf(error), status }
			}
			if (status === 403) {
				return { ok: false, status, error }
			}
			console.warn(
				"[Hozy's Message Select] REST delete failed, trying MessageActions:",
				error,
			)
		}
	}

	const actions = getMessageActions()
	if (actions && typeof actions.deleteMessage === 'function') {
		try {
			await actions.deleteMessage(channelId, messageId)
			return { ok: true }
		} catch (error: any) {
			const status = Number(error?.status ?? error?.statusCode ?? 0)
			if (status === 404 || error?.body?.code === 10008) {
				return { ok: true, missing: true, status }
			}
			if (status === 429) {
				return { ok: false, retryAfter: retryAfterOf(error), status }
			}
			return { ok: false, status, error }
		}
	}

	return { ok: false, error: new Error('No delete API available') }
}

async function runDeletion(channelId: string) {
	const map = selections.get(channelId)
	if (!map || map.size === 0) return
	if (deleting) {
		showToast('Already deleting selected messages…')
		return
	}

	deleting = true
	const generation = ++deleteGeneration
	const settings = getSettings()
	const items = [...map.values()]
	let deleted = 0
	let failed = 0
	let rateLimited = 0

	try {
		for (let index = 0; index < items.length; index++) {
			if (stopped || generation !== deleteGeneration) break
			const item = items[index]
			if (settings.showProgress) {
				showToast(`Deleting ${index + 1}/${items.length}…`)
			}

			let done = false
			for (let attempt = 0; attempt < 2 && !done; attempt++) {
				const result = await deleteOne(item.channelId, item.id)
				if (result.ok) {
					done = true
					deleted++
					map.delete(item.id)
					break
				}
				if (result.retryAfter && attempt === 0) {
					rateLimited++
					if (settings.showProgress) {
						showToast(
							`Rate limited — waiting ${Math.ceil(result.retryAfter / 1000)}s…`,
							'critical',
						)
					}
					await sleep(result.retryAfter)
					continue
				}
				break
			}

			if (!done) failed++
			if (index < items.length - 1 && !stopped) {
				await sleep(settings.delayMs)
			}
		}
	} catch (error) {
		console.error("[Hozy's Message Select] Delete loop failed:", error)
	} finally {
		if (generation === deleteGeneration) deleting = false
	}

	if (map.size === 0) selections.delete(channelId)
	if (stopped) return

	const parts = [
		`Deleted ${deleted} ${deleted === 1 ? 'message' : 'messages'}`,
	]
	if (failed > 0) parts.push(`${failed} failed`)
	if (rateLimited > 0 && failed > 0) parts.push('rate limited')
	showToast(`${parts.join(' · ')}.`, failed > 0 ? 'critical' : 'success')
}

function scheduleConfirm(channelId: string) {
	if (confirmTimer) clearTimeout(confirmTimer)
	confirmTimer = setTimeout(() => {
		confirmTimer = undefined
		if (!stopped) openConfirm(channelId)
	}, 300)
}

function openConfirm(channelId: string) {
	const map = selections.get(channelId)
	if (!map || map.size === 0) {
		showToast('No messages selected.', 'critical')
		return
	}

	if (!getSettings().confirmDelete) {
		void runDeletion(channelId)
		return
	}

	const items = [...map.values()]
	const previews = items
		.slice(0, 5)
		.map(item => `• ${item.author}: ${item.preview}`)
		.join('\n')
	const more =
		items.length > 5 ? `\n…and ${items.length - 5} more` : ''
	const countLabel = items.length === 1 ? 'message' : 'messages'

	try {
		AlertActionCreators.openAlert(
			CONFIRM_KEY,
			createElement(Design.AlertModal, {
				title: `Delete ${items.length} ${countLabel}?`,
				content:
					'This permanently deletes the selected messages for everyone. This cannot be undone.',
				extraContent: createElement(Design.Text, {
					variant: 'text-sm/medium',
					children: previews + more,
				}),
				actions: createElement(
					Design.Stack,
					{ direction: 'horizontal', spacing: 8 },
					createElement(Design.AlertActionButton, {
						text: 'Cancel',
						variant: 'secondary',
						onPress: () =>
							AlertActionCreators.dismissAlert(CONFIRM_KEY),
					}),
					createElement(Design.AlertActionButton, {
						text: `Delete ${items.length}`,
						variant: 'destructive',
						onPress: () => {
							AlertActionCreators.dismissAlert(CONFIRM_KEY)
							void runDeletion(channelId)
						},
					}),
				),
			}),
		)
	} catch (error) {
		console.error(
			"[Hozy's Message Select] Failed to open confirmation:",
			error,
		)
		showToast('Could not open the confirmation dialog.', 'critical')
	}
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log("Hozy's Message Select started.")

		stopped = false
		deleting = false
		deleteGeneration = 0
		pendingMessage = undefined
		selections.clear()
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

		for (const name of NAMES) {
			try {
				const [existing] = lookupModule(withName(name))
				if (existing) patchComponent(existing, cleanup)
			} catch (error) {
				console.error(
					`[Hozy's Message Select] Initial lookup failed for ${name}:`,
					error,
				)
			}
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
							injectRows({ message: pendingMessage }, element) ??
							element
						)
					} catch (error) {
						console.error(
							"[Hozy's Message Select] Sheet injection failed:",
							error,
						)
						return element
					}
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

		if (
			typeof ActionSheetActionCreators?.hideAllActionSheets ===
			'function'
		) {
			cleanup(
				before(
					ActionSheetActionCreators,
					'hideAllActionSheets',
					args => {
						pendingMessage = undefined
						return args
					},
				),
			)
		}

		cleanup(
			onFluxEventDispatched('MESSAGE_DELETE', (payload: any) => {
				const id =
					payload?.id ?? payload?.messageId ?? payload?.message?.id
				const channelId =
					payload?.channelId ??
					payload?.channel_id ??
					payload?.message?.channel_id
				if (id) {
					removeSelection(
						channelId ? String(channelId) : undefined,
						String(id),
					)
				}
				return payload
			}),
		)

		cleanup(
			onFluxEventDispatched('MESSAGE_DELETE_BULK', (payload: any) => {
				const channelId = payload?.channelId ?? payload?.channel_id
				const ids = Array.isArray(payload?.ids) ? payload.ids : []
				for (const id of ids) {
					removeSelection(
						channelId ? String(channelId) : undefined,
						String(id),
					)
				}
				return payload
			}),
		)
	},
	stop({ logger }) {
		stopped = true
		deleting = false
		deleteGeneration++
		pendingMessage = undefined
		selections.clear()
		if (confirmTimer) {
			clearTimeout(confirmTimer)
			confirmTimer = undefined
		}
		try {
			AlertActionCreators.dismissAlert(CONFIRM_KEY)
		} catch {}
		logger.log("Hozy's Message Select stopped.")
	},
})
