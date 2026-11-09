import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

type AnyRecord = Record<string, any>

const DISCORD_EPOCH = 1_420_070_400_000
const AUTHOR_ID = '1081680102673653840'

let snowflakeCounter = 0

function snowflake(now = Date.now()): string {
	// Add rotating increment bits so two messages in the same millisecond
	// do not collide (previously every same-ms message shared id + nonce).
	try {
		snowflakeCounter = (snowflakeCounter + 1) % 0x400000
		const base = BigInt(now - DISCORD_EPOCH) << 22n
		return (base | BigInt(snowflakeCounter)).toString()
	} catch {
		return String(Date.now())
	}
}

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

function isNumericId(value: unknown): value is string {
	return typeof value === 'string' && /^\d{5,}$/.test(value)
}

function buildMessage(
	channelId: string,
	content: string,
	embeds: AnyRecord[] | undefined,
	base?: AnyRecord,
): AnyRecord {
	const now = Date.now()
	const timestamp = new Date(now).toISOString()
	const id = isNumericId(base?.id) ? base.id : snowflake(now)
	const author = {
		id: isNumericId(base?.author?.id) ? base.author.id : AUTHOR_ID,
		username: "Hozy's Chatbot",
		globalName: "Hozy's Chatbot",
		discriminator: '0000',
		avatar: null,
		bot: true,
		publicFlags: 0,
	}

	return {
		...base,
		id,
		type: 0,
		channel_id: channelId,
		channelId,
		content,
		embeds: embeds ?? base?.embeds ?? [],
		author: { ...base?.author, ...author },
		timestamp,
		edited_timestamp: null,
		editedTimestamp: null,
		state: 'SENT',
		flags: 64,
		attachments: [],
		mentions: [],
		mention_roles: [],
		mentionRoles: [],
		mention_everyone: false,
		mentionEveryone: false,
		pinned: false,
		tts: false,
		components: [],
		reactions: [],
		hit: false,
		nonce: id,
		loggingName: "Hozy's Chatbot",
	}
}

export function sendLocalMessage(
	channelId: string,
	content: string,
	embeds?: AnyRecord[],
) {
	if (!channelId || channelId === '-1' || channelId === '0') return false

	try {
		const botModule = findModule('createBotMessage')
		const receiveModule = findModule('receiveMessage') ?? botModule
		let message: AnyRecord | undefined

		if (typeof botModule?.createBotMessage === 'function') {
			try {
				message = botModule.createBotMessage({
					channelId,
					content,
					embeds: embeds ?? [],
					loggingName: "Hozy's Chatbot",
				})
			} catch {}
		}

		message = buildMessage(channelId, content, embeds, message)

		if (typeof receiveModule?.receiveMessage === 'function') {
			const res = receiveModule.receiveMessage(channelId, message)
			// Only report success if Discord actually accepted it.
			// Previously returned true unconditionally, so dropped messages
			// looked delivered and callers never fell back to toast.
			return res !== false
		}

		const dispatcher =
			findModule('dispatch', 'isDispatching') ?? findModule('flushWaitQueue')
		if (typeof dispatcher?.dispatch === 'function') {
			const res = dispatcher.dispatch({
				type: 'MESSAGE_CREATE',
				channelId,
				optimistic: true,
				isPushNotification: false,
				message,
			})
			return res !== false
		}
	} catch (error) {
		console.error("[Hozy's Chatbot] Failed to send local message:", error)
	}

	return false
}
