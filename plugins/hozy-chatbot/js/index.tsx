import { ToastActionCreators } from '@valenced/discord/actions'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
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

/* Mutable WeakSet so stop() can clear it and allow re-patch on next start.
   Previously `const` and never cleared -> plugin was dead after one stop/start. */
let seenModules = new WeakSet<object>()
const patchedSendModules = new Set<AnyRecord>()
let moduleLoadedToastTimer: ReturnType<typeof setTimeout> | undefined

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
	const c = (r as AnyRecord).content ?? (r as AnyRecord).text ?? ''
	// Content can be an array/object (embed/component message).
	// Return '' instead of a non-string so callers can safely bail.
	return typeof c === 'string' ? c : ''
}

function parseAsk(content: string): string | null {
	if (typeof content !== 'string') return null
	const text = content.trim()
	if (!text) return null
	// /ask <question> | !ask <question> | .ask <question>
	const m = text.match(/^(?:\/|!|\.)ask\s+(.+)$/is)
	if (m && m[1]) return m[1].trim()
	return null
}

function isValidChannelId(id: string): boolean {
	return !!id && id !== '-1' && id !== '0'
}

/** Split a long answer into Discord-safe chunks (2000 char limit). */
function splitForDiscord(text: string, limit = 1900): string[] {
	if (text.length <= limit) return [text]
	const chunks: string[] = []
	let rest = text
	while (rest.length > limit) {
		let cut = rest.lastIndexOf('\n', limit)
		if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit)
		if (cut < 1) cut = limit
		chunks.push(rest.slice(0, cut))
		rest = rest.slice(cut).replace(/^\n+/, '')
	}
	if (rest) chunks.push(rest)
	return chunks
}

async function answer(question: string, channelId: string) {
	// Fix settings load race: ensure storage cache is loaded before reading key.
	try {
		await getStorage().get()
	} catch {}
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
		if (!isValidChannelId(channelId)) {
			// No channel context — show as toast instead of guessing a stale channel.
			// Truncate for toast readability.
			showToast(text.slice(0, 180) + (text.length > 180 ? '…' : ''), 'success')
			return
		}
		// Send in chunks so long LLM answers are not dropped by Discord's 2000 limit.
		const chunks = splitForDiscord(body)
		let sentAny = false
		for (const chunk of chunks) {
			const sent = sendLocalMessage(channelId, chunk)
			if (sent) sentAny = true
			// If chunking fails midway, fall back to toast for remaining text.
			if (!sent) {
				showToast(text.slice(0, 180) + (text.length > 180 ? '…' : ''), 'success')
				break
			}
		}
		if (!sentAny) showToast(text.slice(0, 180) + '…', 'success')
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Chatbot failed'
		showToast(formatError(msg), 'critical')
	}
}

function commandFrom(list: any[]) {
	// Keep the same shape as the working 1.2.0: spread a real built-in command
	// so Discord's native command code gets every field it expects, but use a
	// numeric-string id (Discord expects numeric IDs — a non-numeric id can
	// crash Discord on /ask). Avoid colliding with APP_ID '-1'.
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
		description: "Ask Hozy's Chatbot locally",
		displayDescription: "Ask Hozy's Chatbot locally",
		untranslatedDescription: "Ask Hozy's Chatbot locally",
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
				// Only trust real channel fields — applicationId is an app ID, not a channel.
				const channelId = String(args?.channelId ?? args?.channel_id ?? '')
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

function patchSend(mod: AnyRecord | undefined, cleanup: Cleanup) {
	if (!mod || typeof mod.sendMessage !== 'function') return
	if ((mod as any).__hozyAskSend) return
	;(mod as any).__hozyAskSend = true
	patchedSendModules.add(mod)
	cleanup(
		instead(
			mod,
			'sendMessage',
			function (this: any, args: any[], original: (...a: any[]) => any) {
				try {
					const message = args.length > 1 ? args[1] : args[0]
					const content = contentOf(message)
					if (typeof content !== 'string') return original.apply(this, args)
					const ask = parseAsk(content)
					if (ask != null) {
						// Use only the real channel from the message payload.
						// Previously fell back to a global lastChannelId tracked from
						// ANY dispatcher action — could deliver the private answer to
						// a previously visited channel (privacy leak). Now we never guess.
						const channelId =
							typeof message === 'object' && message !== null
								? (message as AnyRecord).channel_id ?? (message as AnyRecord).channelId ?? ''
								: ''
						const cid = String(channelId || '')
						if (!isValidChannelId(cid)) {
							// Still swallow the message (typed /ask must never go to the server)
							// but tell the user we couldn't route the answer.
							showToast('Could not determine channel for answer.', 'critical')
						} else {
							void answer(ask, cid)
						}
						return Promise.resolve({ valid: true, body: {} })
					}
				} catch (error) {
					console.error("[Hozy's Chatbot] send intercept failed, forwarding to original:", error)
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
		if (moduleLoadedToastTimer) {
			clearTimeout(moduleLoadedToastTimer)
			moduleLoadedToastTimer = undefined
		}
	})

	// Fail-open guard: if sendMessage never loads, typed /ask would be sent for
	// real to Discord servers (leaking the question). Warn the user.
	moduleLoadedToastTimer = setTimeout(() => {
		if (stopped) return
		if (patchedSendModules.size === 0) {
			showToast('Chatbot module not loaded — /ask disabled until Discord loads it.', 'critical')
		}
	}, 5000)

	// Slash-command injection is DISABLED intentionally: injecting a fake
	// built-in command crashed Discord (/ask kick). Typed "/ask ..." is
	// intercepted in sendMessage below — same result, zero crash risk.
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

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log("Hozy's Chatbot started.")
		// Pre-warm storage so getSettings() does not race with a cold cache.
		void (async () => {
			try {
				await getStorage().get()
			} catch {}
		})()
		attach(cleanup)
		// Note: we intentionally do NOT intercept global dispatch.
		// The answer channel is derived only from the /ask invocation itself.
	},
	stop({ logger }) {
		logger.log("Hozy's Chatbot stopped.")
		// Allow re-patch on next start (hot reload / disable->enable).
		seenModules = new WeakSet<object>()
		for (const mod of patchedSendModules) {
			try {
				delete (mod as any).__hozyAskSend
			} catch {}
		}
		patchedSendModules.clear()
		if (moduleLoadedToastTimer) {
			clearTimeout(moduleLoadedToastTimer)
			moduleLoadedToastTimer = undefined
		}
	},
})
