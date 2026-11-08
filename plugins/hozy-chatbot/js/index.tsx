import { ToastActionCreators } from '@valenced/discord/actions'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before, instead } from '@valenced/patcher'
import { createElement, isValidElement } from 'react'
import { askLlm } from './llm'
import { sendLocalMessage } from './local-message'
import { getSettings, getStorage, SettingsComponent } from './settings'

type AnyRecord = Record<string, any>
type Cleanup = (...fns: Array<() => any>) => void

const NAME = 'ask'
const APP_ID = '-1'
const CHAT = 1
const BUILT_IN = 0
const LAST = { priority: 9999 }

const seenModules = new WeakSet<object>()

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

function showToast(
	text: string,
	variant: 'default' | 'success' | 'critical' = 'default',
) {
	try {
		ToastActionCreators.open('hozy-chatbot', { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key: 'hozy-chatbot', content: text })
		} catch {
			console.log("[Hozy's Chatbot]", text)
		}
	}
}

function formatError(msg: string): string {
	const m = (msg || '').toLowerCase()
	if (m.includes('api key') || m.includes('401') || m.includes('403') || m.includes('invalid')) {
		return 'Invalid or missing API key. Paste it in plugin Settings.'
	}
	if (m.includes('empty') || m.includes('nothing')) {
		return 'Nothing to ask.'
	}
	if (m.includes('network') || m.includes('fetch') || m.includes('download')) {
		return (msg || 'Network error').slice(0, 120)
	}
	return (msg || 'Chatbot failed').slice(0, 120)
}

function contentOf(value: unknown): string {
	if (typeof value === 'string') return value
	if (!value || typeof value !== 'object') return ''
	const r = value as AnyRecord
	return r.content ?? r.text ?? ''
}

function parseAsk(content: string): string | null {
	const text = content.trim()
	if (!text) return null
	// /ask <question> | !ask <question> | .ask <question>
	const m = text.match(/^(?:\/|!|\.)ask\s+(.+)$/i)
	if (m && m[1]) return m[1].trim()
	return null
}

async function answer(question: string, channelId: string) {
	const settings = getSettings()
	showToast('Asking…')
	try {
		const result = await askLlm(settings, question)
		const text = result.text.trim()
		if (!text) {
			showToast('Empty answer. Try again.', 'critical')
			return
		}
		// Normal local message — Discord markdown (*, **, `code`, ```blocks) renders natively.
		const body = `**${result.providerUsed}**\n\n${text}`
		if (!channelId) {
			showToast(text, 'success')
			return
		}
		const sent = sendLocalMessage(channelId, body)
		if (!sent) showToast(text, 'success')
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Chatbot failed'
		showToast(formatError(msg), 'critical')
	}
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
		description: 'Ask Hozy\'s Chatbot locally',
		displayDescription: 'Ask Hozy\'s Chatbot locally',
		untranslatedDescription: 'Ask Hozy\'s Chatbot locally',
		inputType: BUILT_IN,
		type: CHAT,
		options: [{ name: 'prompt', type: 3, description: 'Your question', required: true }],
		guildId: undefined,
		target: undefined,
		dmPermission: true,
		predicate: () => true,
		shouldHide: undefined,
		__bunny: undefined,
		execute: (args: any) => {
			void (async () => {
				const channelId = String(
					args?.channelId ?? args?.channel_id ?? args?.applicationId ?? '',
				)
				const prompt =
					(typeof args?.prompt === 'string' && args.prompt) ||
					args?.options?.[0]?.value ||
					args?.prompt ||
					''
				const q = String(prompt).trim()
				if (!q) {
					showToast('Type /ask <question> in chat.', 'critical')
					return
				}
				await answer(q, channelId)
			})()
		},
	}
}

function withAskCommand(result: unknown) {
	if (!Array.isArray(result)) return result
	if (result.some(cmd => cmd?.name === NAME)) return result
	return [...result, commandFrom(result)]
}

function patchCommands(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.getBuiltInCommands !== 'function') return
	if (seenModules.has(mod)) return
	seenModules.add(mod)

	cleanup(
		after(
			mod,
			'getBuiltInCommands',
			(res: unknown) => {
				try {
					return withAskCommand(res)
				} catch (error) {
					console.error("[Hozy's Chatbot] command inject failed:", error)
					return res
				}
			},
			LAST,
		),
	)
}

let lastChannelId = ''

function patchSend(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	if ((mod as any).__hozyAskSend) return
	;(mod as any).__hozyAskSend = true
	cleanup(
		instead(
			mod,
			'sendMessage',
			function (this: any, args: any[], original: (...a: any[]) => any) {
				const message = args.length > 1 ? args[1] : args[0]
				const content = contentOf(message)
				const ask = parseAsk(content)
				if (ask != null) {
					const channelId =
						(typeof message === 'object' && message !== null
							? (message as AnyRecord).channel_id ??
							  (message as AnyRecord).channelId ??
							  ''
							: '') ||
						lastChannelId
					void answer(ask, String(channelId || lastChannelId || ''))
					return Promise.resolve({ valid: true, body: {} })
				}
				return original.apply(this, args)
			},
			LAST,
		),
	)
}

function attach(cleanup: Cleanup) {
	cleanup(
		waitForModules(withProps('getBuiltInCommands'), (exports: unknown) => {
			patchCommands(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
	try {
		const [found] = lookupModule(withProps('getBuiltInCommands'))
		if (found) patchCommands(asModule(found) ?? (found as AnyRecord), cleanup)
	} catch {}

	cleanup(
		waitForModules(withProps('sendMessage', 'editMessage'), (exports: unknown) => {
			patchSend(asModule(exports) ?? (exports as AnyRecord), cleanup)
		}),
	)
	try {
		const [found] = lookupModule(withProps('sendMessage', 'editMessage'))
		if (found) patchSend(asModule(found) ?? (found as AnyRecord), cleanup)
	} catch {}
}

function rememberChannelFrom(action: any) {
	const id = firstString(action?.channelId, action?.channel_id, action?.channel?.id)
	if (id) lastChannelId = id
}

function firstString(...values: unknown[]): string | undefined {
	for (const v of values) {
		if (typeof v === 'string' && v.trim()) return v.trim()
	}
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log("Hozy's Chatbot started.")
		void getStorage().get()
		attach(cleanup)

		// Remember last channel so /ask answer can go back to the same chat
		try {
			const [dispatcher] = lookupModule(withProps('dispatch', 'isDispatching'))
			const d = asModule(dispatcher) ?? (dispatcher as AnyRecord)
			if (d && typeof d.dispatch === 'function') {
				cleanup(
					instead(d, 'dispatch', function (this: any, args: any[], original: (...a: any[]) => any) {
						try {
							rememberChannelFrom(args[0])
						} catch {}
						return original.apply(this, args)
					}),
				)
			}
		} catch {}
	},
	stop({ logger }) {
		logger.log("Hozy's Chatbot stopped.")
	},
})
