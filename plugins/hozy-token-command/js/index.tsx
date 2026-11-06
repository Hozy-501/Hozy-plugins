import { Page } from '@valenced/components'
import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModules, lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { createElement } from 'react'

type AnyRecord = Record<string, any>
type Cleanup = (...fns: Array<() => any>) => void

const NAME = 'token'
const APP_ID = '-1'
const CHAT = 1
const BUILT_IN = 0

const patched = new WeakSet<object>()

function asModule(value: unknown): AnyRecord | undefined {
	if (!value || typeof value !== 'object') return
	const rec = value as AnyRecord
	if (typeof rec.getBuiltInCommands === 'function') return rec
	if (typeof rec.sendMessage === 'function') return rec
	if (typeof rec.getToken === 'function') return rec
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
		const api = asModule(clip) ?? (clip as AnyRecord)
		if (typeof api?.setString === 'function') {
			api.setString(text)
			toast('Token copied.', 'success')
			return
		}
	} catch {}
	toast('Could not copy token.', 'critical')
}

function showToken() {
	const token = getToken()

	try {
		AlertActionCreators.openAlert(
			'hozy-token',
			createElement(Design.AlertModal, {
				title: "Hozy's Token",
				content: token
					? 'Only you can see this. Anyone with this token can use your account.'
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
						if (token) copy(token)
						AlertActionCreators.dismissAlert('hozy-token')
					},
				}),
			}),
		)
		return
	} catch (error) {
		console.error('[Hozy Token] alert failed:', error)
	}

	if (token) copy(token)
	else toast('Token not found.', 'critical')
}

function isTokenCommand(value: unknown) {
	if (typeof value !== 'string') return false
	const text = value.trim().toLowerCase()
	return (
		text === '/token' ||
		text === 'token' ||
		text === '.token' ||
		text === '!token'
	)
}

function commandFrom(list: any[]) {
	const sample = list.find(cmd => cmd && typeof cmd.name === 'string') ?? {}
	const ids = list.map(cmd => Number(cmd?.id)).filter(n => Number.isFinite(n))
	const id = ids.length ? String(Math.min(...ids) - 1) : '-2'

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
		execute: () => {
			showToken()
		},
	}
}

function withTokenCommand(result: unknown) {
	if (!Array.isArray(result)) return result
	if (result.some(cmd => cmd?.name === NAME)) return result
	if (
		result.length &&
		!result.some(
			cmd => cmd && typeof cmd === 'object' && typeof cmd.name === 'string',
		)
	)
		return result
	return [...result, commandFrom(result)]
}

function hook(
	mod: AnyRecord,
	key: string,
	cleanup: Cleanup,
	fn: (this: any, args: any[], original: (...a: any[]) => any) => any,
) {
	if (typeof mod[key] !== 'function') return
	if (patched.has(mod) && (mod as any)[`__hozy_${key}`]) return
	;(mod as any)[`__hozy_${key}`] = true
	cleanup(instead(mod, key, fn))
}

function patchCommands(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.getBuiltInCommands !== 'function') return
	if (patched.has(mod)) return
	patched.add(mod)

	hook(mod, 'getBuiltInCommands', cleanup, function (args, original) {
		const res = original.apply(this, args)
		try {
			return withTokenCommand(res)
		} catch (error) {
			console.error('[Hozy Token] command inject failed:', error)
			return res
		}
	})
}

function patchSend(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	hook(mod, 'sendMessage', cleanup, function (args, original) {
		const message = args.length > 1 ? args[1] : args[0]
		const content =
			typeof message === 'string'
				? message
				: (message?.content ?? message?.text)
		if (isTokenCommand(content)) {
			showToken()
			return Promise.resolve({ valid: true, body: {} })
		}
		return original.apply(this, args)
	})
}

function attach(cleanup: Cleanup) {
	cleanup(
		getModules(withProps('getBuiltInCommands'), (exports: unknown) => {
			patchCommands(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
	cleanup(
		getModules(withProps('sendMessage', 'editMessage'), (exports: unknown) => {
			patchSend(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
}

function SettingsComponent() {
	return (
		<Page>
			<Design.TableRowGroup title="Token">
				<Design.TableRow
					label="Show account token"
					subLabel="Visible only to you"
					arrow
					onPress={() => showToken()}
				/>
			</Design.TableRowGroup>
			<Design.TableRowGroup
				title="How to use"
				description="Type /token in any chat, or tap the row above."
			>
				<Design.TableRow label="/token" subLabel="Built-in local command" />
			</Design.TableRowGroup>
		</Page>
	)
}

export default plugin({
	SettingsComponent,
	init({ cleanup, logger }) {
		logger.log('Hozy Token 2.0 init')
		attach(cleanup)
	},
	start({ cleanup, logger }) {
		logger.log('Hozy Token 2.0 start')
		attach(cleanup)
	},
	stop({ logger }) {
		logger.log('Hozy Token 2.0 stop')
	},
})
