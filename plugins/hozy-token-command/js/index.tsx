import { Page } from '@valenced/components'
import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules, lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { createElement } from 'react'

type AnyRecord = Record<string, any>
type Cleanup = (...fns: Array<() => any>) => void

const COMMAND_NAME = 'token'
const APPLICATION_ID = '-1'
const CHAT_COMMAND = 1
const BUILT_IN_INPUT = 0
const patched = new WeakSet<object>()

function unwrap(mod: unknown): AnyRecord | undefined {
	if (!mod || typeof mod !== 'object') return
	const rec = mod as AnyRecord
	if (
		typeof rec.getBuiltInCommands === 'function' ||
		typeof rec.getCommands === 'function' ||
		typeof rec.sendMessage === 'function' ||
		typeof rec.getToken === 'function' ||
		typeof rec.executeCommand === 'function'
	)
		return rec
	if (rec.default && typeof rec.default === 'object')
		return unwrap(rec.default) ?? (rec.default as AnyRecord)
}

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
			console.error('[Hozy Token]', text)
		}
	}
}

function getToken(): string {
	if (typeof (getToken as any)._last === 'string' && (getToken as any)._last)
		return (getToken as any)._last
	try {
		const [exports] = lookupModule(withProps('getToken'))
		const store = unwrap(exports) ?? (exports as AnyRecord)
		if (typeof store?.getToken === 'function') {
			const token = store.getToken()
			if (typeof token === 'string' && token) {
				;(getToken as any)._last = token
				return token
			}
		}
	} catch {}
	return ''
}

function readTokenNow(): string {
	return getToken()
}

function copyToken(token: string) {
	try {
		Clipboard.setString(token)
		showToast('hozy-token-copied', 'Token copied.', 'success')
	} catch {
		showToast('hozy-token-copy-fail', 'Could not copy token.', 'critical')
	}
}

function showTokenAlert() {
	const token = readTokenNow()
	const body = token || 'Token not found.'

	try {
		AlertActionCreators.openAlert(
			'hozy-token-alert',
			createElement(Design.AlertModal, {
				title: "Hozy's Token",
				content: token
					? 'Your account token. Keep it private — anyone with it can use your account.'
					: 'Could not read the account token.',
				extraContent: createElement(Design.Text, {
					variant: 'text-sm/medium',
					selectable: true,
					style: { color: '#dbdee1' },
					children: body,
				}),
				actions: token
					? createElement(Design.AlertActionButton, {
							text: 'Copy token',
							variant: 'primary',
							onPress: () => {
								copyToken(token)
								AlertActionCreators.dismissAlert('hozy-token-alert')
							},
						})
					: createElement(Design.AlertActionButton, {
							text: 'OK',
							variant: 'secondary',
							onPress: () =>
								AlertActionCreators.dismissAlert('hozy-token-alert'),
						}),
			}),
		)
		return
	} catch (error) {
		console.error('[Hozy Token] Alert failed:', error)
	}

	if (token) copyToken(token)
	else showToast('hozy-token-missing', 'Token not found.', 'critical')
}

function isTokenText(value: unknown): boolean {
	if (typeof value !== 'string') return false
	const text = value.trim().toLowerCase().replace(/^\//, '')
	return text === 'token' || text === '.token' || text === '!token'
}

function messageLooksLikeToken(message: any): boolean {
	if (!message) return false
	if (isTokenText(message)) return true
	if (isTokenText(message.content)) return true
	if (isTokenText(message.text)) return true
	if (message.content?.content && isTokenText(message.content.content))
		return true
	return false
}

function toArray(list: unknown): any[] | undefined {
	if (Array.isArray(list)) return list
	if (list && typeof (list as any)[Symbol.iterator] === 'function') {
		try {
			return Array.from(list as Iterable<any>)
		} catch {}
	}
}

function wantsChatCommands(type: unknown): boolean {
	if (type == null || type === CHAT_COMMAND) return true
	if (Array.isArray(type))
		return type.length === 0 || type.includes(CHAT_COMMAND)
	return true
}

function nextCommandId(list: any[]): string {
	const ids = list.map(cmd => Number(cmd?.id)).filter(id => Number.isFinite(id))
	if (!ids.length) return '-2'
	return String(Math.min(...ids) - 1)
}

function makeCommand(list: any[]) {
	const name = COMMAND_NAME
	const description = 'Show your Discord token locally'
	const template =
		list.find(
			cmd => cmd && typeof cmd === 'object' && typeof cmd.name === 'string',
		) ?? {}
	return {
		...template,
		id: nextCommandId(list),
		applicationId: template.applicationId ?? APPLICATION_ID,
		name,
		displayName: name,
		untranslatedName: name,
		description,
		displayDescription: description,
		untranslatedDescription: description,
		inputType: BUILT_IN_INPUT,
		type: CHAT_COMMAND,
		target: undefined,
		guildId: undefined,
		dmPermission: true,
		integrationTypes: [0, 1],
		contexts: [0, 1, 2],
		options: [],
		predicate: () => true,
		execute() {
			showTokenAlert()
		},
	}
}

function injectCommand(list: unknown): unknown {
	const arr = toArray(list)
	if (!arr) return list
	if (arr.some((cmd: any) => cmd?.name === COMMAND_NAME)) return arr
	return [...arr, makeCommand(arr)]
}

function patchMethod(
	mod: AnyRecord,
	key: string,
	cleanup: Cleanup,
	hook: (this: any, args: any[], original: (...a: any[]) => any) => any,
) {
	if (typeof mod[key] !== 'function') return
	const mark = `__hozyToken_${key}`
	if ((mod as any)[mark]) return
	;(mod as any)[mark] = true
	cleanup(instead(mod, key, hook))
}

function patchCommands(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || patched.has(mod)) return
	if (
		typeof mod.getBuiltInCommands !== 'function' &&
		typeof mod.getCommands !== 'function'
	)
		return
	patched.add(mod)

	patchMethod(mod, 'getBuiltInCommands', cleanup, function (args, original) {
		const res = original.apply(this, args)
		try {
			if (!wantsChatCommands(args[0])) return res
			return injectCommand(res)
		} catch (error) {
			console.error('[Hozy Token] inject failed:', error)
			return res
		}
	})
	patchMethod(mod, 'getCommands', cleanup, function (args, original) {
		const res = original.apply(this, args)
		try {
			return injectCommand(res)
		} catch {
			return res
		}
	})
	patchMethod(mod, 'query', cleanup, function (args, original) {
		const res = original.apply(this, args)
		try {
			return injectCommand(res)
		} catch {
			return res
		}
	})
}

function patchSendMessage(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	patchMethod(mod, 'sendMessage', cleanup, function (args, original) {
		const message = args.length > 1 ? args[1] : args[0]
		if (messageLooksLikeToken(message) || isTokenText(args[0])) {
			showTokenAlert()
			return Promise.resolve({ valid: true, body: {} })
		}
		return original.apply(this, args)
	})
}

function patchExecute(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod) return
	patchMethod(mod, 'executeCommand', cleanup, function (args, original) {
		const cmd = args[0]
		if (cmd?.name === COMMAND_NAME || isTokenText(cmd?.name)) {
			showTokenAlert()
			return Promise.resolve()
		}
		return original.apply(this, args)
	})
}

function watch(
	filter: ReturnType<typeof withProps>,
	apply: (mod: AnyRecord) => void,
	cleanup: Cleanup,
) {
	cleanup(
		getModules(filter, (exports: unknown) => {
			const mod = unwrap(exports) ?? (exports as AnyRecord)
			if (mod) apply(mod)
		}),
	)
}

function install(cleanup: Cleanup) {
	watch(
		withProps('getBuiltInCommands'),
		mod => patchCommands(mod, cleanup),
		cleanup,
	)
	watch(withProps('getCommands'), mod => patchCommands(mod, cleanup), cleanup)
	watch(
		withProps('sendMessage'),
		mod => patchSendMessage(mod, cleanup),
		cleanup,
	)
	watch(withProps('executeCommand'), mod => patchExecute(mod, cleanup), cleanup)
	watch(
		withProps('getToken'),
		mod => {
			if (typeof mod.getToken === 'function') {
				try {
					const token = mod.getToken()
					if (typeof token === 'string' && token)
						(getToken as any)._last = token
				} catch {}
			}
		},
		cleanup,
	)
}

function SettingsComponent() {
	return (
		<Page>
			<Design.TableRowGroup title="Token">
				<Design.TableRow
					label="Show account token"
					subLabel="Visible only to you. Never share it."
					arrow
					onPress={() => showTokenAlert()}
				/>
			</Design.TableRowGroup>
			<Design.TableRowGroup title="Command">
				<Design.TableRow
					label="/token"
					subLabel="Type /token in chat, or tap the row above"
				/>
			</Design.TableRowGroup>
		</Page>
	)
}

export default plugin({
	SettingsComponent,
	init({ cleanup, logger }) {
		logger.log('Hozy Token plugin init.')
		install(cleanup)
	},
	start({ cleanup, logger }) {
		logger.log('Hozy Token plugin active.')
		install(cleanup)
	},
	stop({ logger }) {
		logger.log('Hozy Token plugin stopped.')
	},
})
