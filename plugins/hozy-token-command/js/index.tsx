import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { createElement } from 'react'

type AnyRecord = Record<string, any>
type Cleanup = (...fns: Array<() => any>) => void

const COMMAND_NAME = 'token'
const COMMAND_ID = '-501501'
const APPLICATION_ID = '-1'
const patched = new WeakSet<object>()

function unwrap(mod: unknown): AnyRecord | undefined {
	if (!mod || typeof mod !== 'object') return
	const rec = mod as AnyRecord
	if (
		typeof rec.getBuiltInCommands === 'function' ||
		typeof rec.sendMessage === 'function' ||
		typeof rec.getToken === 'function' ||
		typeof rec.receiveMessage === 'function'
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

function makeCommand() {
	return {
		id: COMMAND_ID,
		applicationId: APPLICATION_ID,
		name: COMMAND_NAME,
		displayName: COMMAND_NAME,
		description: 'Show your Discord token locally',
		displayDescription: 'Show your Discord token locally',
		inputType: 0,
		type: 1,
		options: [],
		execute() {
			showTokenAlert()
		},
	}
}

function injectCommand(list: unknown): unknown {
	if (!Array.isArray(list)) return list
	if (
		list.some(
			(cmd: any) => cmd?.name === COMMAND_NAME || cmd?.id === COMMAND_ID,
		)
	)
		return list
	return [...list, makeCommand()]
}

function patchCommands(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || patched.has(mod)) return
	if (typeof mod.getBuiltInCommands !== 'function') return
	patched.add(mod)
	cleanup(after(mod, 'getBuiltInCommands', (_args, res) => injectCommand(res)))
}

function patchSendMessage(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || patched.has(mod)) return
	if (typeof mod.sendMessage !== 'function') return
	patched.add(mod)
	cleanup(
		instead(mod, 'sendMessage', (args, original) => {
			const message = args[1]
			if (messageLooksLikeToken(message) || isTokenText(args[0])) {
				showTokenAlert()
				return Promise.resolve({ valid: true, body: {} })
			}
			return original(...args)
		}),
	)
}

export default plugin({
	start({ cleanup, logger }) {
		logger.log('Hozy Token plugin active.')

		patchSendMessage(findModule('sendMessage', 'editMessage'), cleanup)
		patchCommands(findModule('getBuiltInCommands'), cleanup)

		cleanup(
			waitForModules(withProps('getBuiltInCommands'), exports => {
				patchCommands(unwrap(exports), cleanup)
			}),
		)
		cleanup(
			waitForModules(withProps('sendMessage', 'editMessage'), exports => {
				patchSendMessage(unwrap(exports), cleanup)
			}),
		)
	},
	stop({ logger }) {
		logger.log('Hozy Token plugin stopped.')
	},
})
