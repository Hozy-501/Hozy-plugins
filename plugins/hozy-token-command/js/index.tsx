import { Page } from '@valenced/components'
import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, HookPriority, instead } from '@valenced/patcher'
import { createElement } from 'react'

type AnyRecord = Record<string, any>
type Cleanup = (...fns: Array<() => any>) => void

const NAME = 'token'
const APP_ID = '-1'
const CHAT = 1
const BUILT_IN = 0
const LAST = { priority: HookPriority.HIGHEST }

/* Mutable WeakSet so stop() can clear it (previously never cleared ->
   /token dead after one disable->enable). */
let seen = new WeakSet<object>()
const patchedSendModules = new Set<AnyRecord>()
let autoDismissTimer: ReturnType<typeof setTimeout> | undefined

function asModule(value: unknown): AnyRecord | undefined {
	if (!value || typeof value !== 'object') return
	const rec = value as AnyRecord
	if (
		typeof rec.getBuiltInCommands === 'function' ||
		typeof rec.sendMessage === 'function' ||
		typeof rec.getToken === 'function'
	)
		return rec
	if (rec.default && typeof rec.default === 'object')
		return asModule(rec.default) ?? (rec.default as AnyRecord)
}

function toast(
	text: string,
	variant: 'default' | 'success' | 'critical' = 'default',
) {
	try {
		ToastActionCreators.open('hozy-token', { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key: 'hozy-token', content: text })
		} catch {
			console.log('[Hozy Token]', text)
		}
	}
}

function getToken(): string {
	try {
		const [exports] = lookupModule(withProps('getToken'))
		const store = asModule(exports) ?? (exports as AnyRecord)
		const token = store?.getToken?.()
		if (typeof token === 'string' && token) return token
	} catch {}
	return ''
}

function copy(text: string) {
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
			toast('Token copied.', 'success')
			return
		}
	} catch {}
	toast('Could not copy token.', 'critical')
}

function scheduleAutoDismiss() {
	if (autoDismissTimer) clearTimeout(autoDismissTimer)
	autoDismissTimer = setTimeout(() => {
		try {
			AlertActionCreators.dismissAlert('hozy-token')
		} catch {}
		autoDismissTimer = undefined
	}, 30000)
}

function clearAutoDismiss() {
	if (autoDismissTimer) {
		clearTimeout(autoDismissTimer)
		autoDismissTimer = undefined
	}
}

function showToken() {
	const token = getToken()

	try {
		AlertActionCreators.openAlert(
			'hozy-token',
			createElement(Design.AlertModal, {
				title: "Hozy's Token",
				content: token
					? 'Only you can see this. Anyone with this token can use your account. Never share it. This popup closes in 30 seconds.'
					: 'Could not read the account token.',
				extraContent: createElement(Design.Text, {
					variant: 'text-sm/medium',
					selectable: true,
					children: token || 'Token not found.',
				}),
				actions: createElement(Design.AlertActionButton, {
					text: token ? 'Copy token' : 'OK',
					variant: token ? 'primary' : 'secondary',
					onPress: () => {
						clearAutoDismiss()
						if (token) {
							// Read fresh inside the handler so a rotated token is not copied stale.
							const fresh = getToken()
							if (fresh) copy(fresh)
							else copy(token)
						}
						AlertActionCreators.dismissAlert('hozy-token')
					},
				}),
			}),
		)
		if (token) scheduleAutoDismiss()
		return
	} catch (error) {
		console.error('[Hozy Token] alert failed:', error)
	}

	// Do NOT auto-copy on alert failure (previously did this without consent).
	toast('Could not open token dialog. Try Settings → Plugins → Hozy Token.', 'critical')
}

function isTokenCommand(value: unknown) {
	if (typeof value !== 'string') return false
	const text = value.trim().toLowerCase()
	// Only explicit command prefixes. Bare "token" previously suppressed
	// normal chat messages containing just the word "token" and popped the modal.
	return (
		text === '/token' ||
		text === '.token' ||
		text === '!token'
	)
}

function commandFrom(list: any[]) {
	// Keep the same shape as the working version: spread a real built-in
	// command so Discord gets every field it expects, with a numeric-string
	// id (non-numeric ids can crash Discord). Avoid colliding with '-1'.
	const sample: any = list.find(cmd => cmd && typeof cmd.name === 'string') ?? {}
	const ids = list.map(cmd => Number(cmd?.id)).filter(n => Number.isFinite(n))
	let id = ids.length ? String(Math.min(...ids) - 1) : '-2'
	if (id === APP_ID || id === '0') id = '-2'
	return {
		...sample,
		id,
		applicationId: sample.applicationId ?? APP_ID,
		name: NAME,
		displayName: NAME,
		untranslatedName: NAME,
		description: 'Show your Discord token locally',
		displayDescription: 'Show your Discord token locally',
		untranslatedDescription: 'Show your Discord token locally',
		inputType: BUILT_IN,
		type: CHAT,
		options: [],
		guildId: undefined,
		target: undefined,
		dmPermission: true,
		predicate: () => true,
		shouldHide: undefined,
		__bunny: undefined,
		execute: () => {
			showToken()
		},
	}
}

function withTokenCommand(result: unknown) {
	if (!Array.isArray(result)) return result
	if (result.some(cmd => cmd?.name === NAME)) return result
	return [...result, commandFrom(result)]
}

function patchCommands(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.getBuiltInCommands !== 'function') return
	if (seen.has(mod)) return
	seen.add(mod)

	cleanup(
		after(
			mod,
			'getBuiltInCommands',
			res => {
				try {
					return withTokenCommand(res)
				} catch (error) {
					console.error('[Hozy Token] command inject failed:', error)
					return res
				}
			},
			LAST,
		),
	)
}

function patchSend(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	if ((mod as any).__hozySend) return
	;(mod as any).__hozySend = true
	patchedSendModules.add(mod)
	cleanup(
		instead(
			mod,
			'sendMessage',
			function (this: any, args: any[], original: (...a: any[]) => any) {
				try {
					const message = args.length > 1 ? args[1] : args[0]
					const content =
						typeof message === 'string'
							? message
							: typeof message?.content === 'string'
								? message.content
								: typeof message?.text === 'string'
									? message.text
									: ''
					if (isTokenCommand(content)) {
						showToken()
						return Promise.resolve({ valid: true, body: {} })
					}
				} catch (error) {
					console.error('[Hozy Token] send intercept failed, forwarding:', error)
				}
				return original.apply(this, args)
			},
			LAST,
		),
	)
}

function attach(cleanup: Cleanup) {
	let stopped = false
	cleanup(() => {
		stopped = true
	})

	cleanup(
		waitForModules(withProps('getBuiltInCommands'), (exports: unknown) => {
			if (stopped) return
			patchCommands(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
	try {
		const [found] = lookupModule(withProps('getBuiltInCommands'))
		if (found && !stopped) patchCommands(asModule(found) ?? (found as AnyRecord), cleanup)
	} catch {}

	cleanup(
		waitForModules(withProps('sendMessage', 'editMessage'), (exports: unknown) => {
			if (stopped) return
			patchSend(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
	try {
		const [found] = lookupModule(withProps('sendMessage', 'editMessage'))
		if (found && !stopped) patchSend(asModule(found) ?? (found as AnyRecord), cleanup)
	} catch {}
}

function SettingsComponent() {
	return (
		<Page>
			<Design.TableRowGroup title="Token">
				<Design.TableRow
					label="Show account token"
					subLabel="⚠️ Anyone with this token can use your account. Visible only to you."
					arrow
					onPress={() => showToken()}
				/>
			</Design.TableRowGroup>
			<Design.TableRowGroup
				title="How to use"
				description="Type /token in any chat, or tap the row above. Works alongside other built-in command plugins."
			>
				<Design.TableRow label="/token" subLabel="Local command" />
			</Design.TableRowGroup>
		</Page>
	)
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log('Hozy Token 2.0.1 start')
		attach(cleanup)
	},
	stop({ logger }) {
		logger.log('Hozy Token 2.0.1 stop')
		// Allow re-patch on next start; hide any open token popup immediately.
		seen = new WeakSet<object>()
		for (const mod of patchedSendModules) {
			try {
				delete (mod as any).__hozySend
			} catch {}
		}
		patchedSendModules.clear()
		clearAutoDismiss()
		try {
			AlertActionCreators.dismissAlert('hozy-token')
		} catch {}
	},
})
