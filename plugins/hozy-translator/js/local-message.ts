import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

type AnyRecord = Record<string, any>

function unwrap(mod: unknown): AnyRecord | undefined {
	if (!mod || typeof mod !== 'object') return
	const rec = mod as AnyRecord
	if (
		typeof rec.createBotMessage === 'function' ||
		typeof rec.receiveMessage === 'function'
	)
		return rec
	if (rec.default && typeof rec.default === 'object')
		return rec.default as AnyRecord
}

function findModule(prop: string, extra?: string): AnyRecord | undefined {
	const filter = extra ? withProps(prop, extra) : withProps(prop)
	const [mod] = lookupModule(filter)
	return unwrap(mod)
}

export function sendLocalMessage(
	channelId: string,
	content: string,
	embeds?: AnyRecord[],
) {
	if (!channelId) return

	const id = `hozy-translate-${Date.now()}`
	const timestamp = new Date().toISOString()
	const author = {
		id: '1',
		username: "Hozy's Translator",
		discriminator: '0000',
		avatar: 'clyde',
		bot: true,
	}

	try {
		const botModule = findModule('createBotMessage')
		const receiveModule = findModule('receiveMessage') ?? botModule

		if (
			typeof botModule?.createBotMessage === 'function' &&
			typeof receiveModule?.receiveMessage === 'function'
		) {
			const message = botModule.createBotMessage({
				channelId,
				content,
				embeds: embeds ?? [],
				loggingName: "Hozy's Translator",
			})
			if (message) {
				message.author = { ...message.author, ...author }
				if (embeds?.length) message.embeds = embeds
				receiveModule.receiveMessage(channelId, message)
				return
			}
		}

		if (typeof receiveModule?.receiveMessage === 'function') {
			receiveModule.receiveMessage(channelId, {
				id,
				type: 0,
				channel_id: channelId,
				content,
				embeds: embeds ?? [],
				author,
				timestamp,
				state: 'SENT',
				flags: 64,
				attachments: [],
				mentions: [],
				pinned: false,
				mention_everyone: false,
				tts: false,
			})
			return
		}

		const dispatcher =
			findModule('dispatch', 'isDispatching') ?? findModule('flushWaitQueue')
		if (typeof dispatcher?.dispatch === 'function') {
			dispatcher.dispatch({
				type: 'MESSAGE_CREATE',
				channelId,
				optimistic: true,
				isPushNotification: false,
				message: {
					id,
					type: 0,
					channel_id: channelId,
					content,
					embeds: embeds ?? [],
					author,
					timestamp,
					state: 'SENT',
					flags: 64,
					attachments: [],
					mentions: [],
					pinned: false,
					mention_everyone: false,
					tts: false,
				},
			})
		}
	} catch (error) {
		console.error("[Hozy's Translator] Failed to send local message:", error)
	}
}
