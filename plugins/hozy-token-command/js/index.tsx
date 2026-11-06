import { Page } from '@valenced/components'
import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
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
		typeof rec.sendMessage === 'function' ||
		typeof rec.getToken === 'function'
	)
		return rec
	if (rec.default && typeof rec.default === 'object')
		return rec.default as AnyRecord
}

function findModule(...props: string[]): AnyRecord | undefined {
	const [mod] = lookupModule(withProps(...(props as [string, ...string[]])))
	return unwrap(mod)
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
	const store = findModule('getToken')
	if (typeof store?.getToken === 'function') {
		const token = store.getToken()
		if (typeof token === 'string' && token) return token
	}
	return ''
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
	const token = getToken()
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
	const text = value.trim().toLowerCase()
	return (
		text === '/token' ||
		text === '.token' ||
		text === '!token' ||
		text === 'token'
	)
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

function wantsChatCommands(type: unknown): boolean {
	if (type == null) return true
	if (type === CHAT_COMMAND) return true
	if (Array.isArray(type)) return type.includes(CHAT_COMMAND)
	if (typeof type === 'object' && type !== null) {
		try {
			return Array.from(type as Iterable<unknown>).includes(CHAT_COMMAND)
		} catch {
			return true
		}
	}
	return true
}

function looksLikeCommandList(list: unknown): list is any[] {
	return (
		Array.isArray(list) &&
		list.some(
			cmd =>
				cmd &&
				typeof cmd === 'object' &&
				typeof cmd.name === 'string' &&
				(typeof cmd.execute === 'function' || cmd.type === CHAT_COMMAND),
		)
	)
}

function nextCommandId(list: any[]): string {
	const ids = list.map(cmd => Number(cmd?.id)).filter(id => Number.isFinite(id))
	if (!ids.length) return '-2'
	return String(Math.min(...ids) - 1)
}

function makeCommand(list: any[]) {
	const name = COMMAND_NAME
	const description = 'Show your Discord token locally'
	const template = list.find(cmd => cmd && typeof cmd === 'object') ?? {}
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
		inputType: template.inputType ?? BUILT_IN_INPUT,
		type: template.type ?? CHAT_COMMAND,
		target: undefined,
		guildId: undefined,
		options: [],
		predicate: () => true,
		execute() {
			showTokenAlert()
		},
	}
}

function injectCommand(list: unknown): unknown {
	if (!looksLikeCommandList(list)) return list
	if (list.some((cmd: any) => cmd?.name === COMMAND_NAME)) return list
	return [...list, makeCommand(list)]
}

function patchMethod(
	mod: AnyRecord,
	key: string,
	cleanup: Cleanup,
	hook: (args: any[], original: (...a: any[]) => any) => any,
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
		typeof mod.getCommands !== 'function' &&
		typeof mod.query !== 'function'
	)
		return
	patched.add(mod)

	patchMethod(mod, 'getBuiltInCommands', cleanup, (args, original) => {
		const res = original(...args)
		if (!wantsChatCommands(args[0])) return res
		return injectCommand(res)
	})
	patchMethod(mod, 'getCommands', cleanup, (args, original) =>
		injectCommand(original(...args)),
	)
	patchMethod(mod, 'query', cleanup, (args, original) =>
		injectCommand(original(...args)),
	)
}

function patchSendMessage(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	if ((mod as any).__hozyTokenSend) return
	;(mod as any).__hozyTokenSend = true
	cleanup(
		instead(mod, 'sendMessage', (args, original) => {
			const message = args.length > 1 ? args[1] : args[0]
			if (messageLooksLikeToken(message) || isTokenText(args[0])) {
				showTokenAlert()
				return Promise.resolve({ valid: true, body: {} })
			}
			return original(...args)
		}),
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
		</Page>
	)
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log('Hozy Token plugin active.')

		patchSendMessage(findModule('sendMessage', 'editMessage'), cleanup)
		patchSendMessage(findModule('sendMessage'), cleanup)
		patchCommands(findModule('getBuiltInCommands'), cleanup)
		patchCommands(findModule('getCommands'), cleanup)

		cleanup(
			waitForModules(withProps('getBuiltInCommands'), exports => {
				patchCommands(unwrap(exports), cleanup)
			}),
		)
		cleanup(
			waitForModules(withProps('getCommands'), exports => {
				patchCommands(unwrap(exports), cleanup)
			}),
		)
		cleanup(
			waitForModules(withProps('sendMessage'), exports => {
				patchSendMessage(unwrap(exports), cleanup)
			}),
		)
		cleanup(
			waitForModules(withProps('executeCommand'), exports => {
				const mod = unwrap(exports)
				if (!mod) return
				patchMethod(mod, 'executeCommand', cleanup, (args, original) => {
					const cmd = args[0]
					if (
						cmd?.name === COMMAND_NAME ||
						isTokenText(cmd?.name) ||
						isTokenText(args[1])
					) {
						showTokenAlert()
						return Promise.resolve()
					}
					return original(...args)
				})
			}),
		)
	},
	stop({ logger }) {
		logger.log('Hozy Token plugin stopped.')
	},
})
