import { ToastActionCreators } from '@valenced/discord/actions'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import {
	type AttachmentInfo,
	getGhostStorage,
	hasLinkIn,
	trackCreate,
	trackDelete,
	trackEdit,
} from './ghost'
import { getSettings, getStorage, SettingsComponent } from './settings'

type AnyRecord = Record<string, any>

const seenDispatchers = new WeakSet<object>()

function showToast(key: string, text: string, variant: 'default' | 'success' | 'critical' = 'default') {
	try {
		ToastActionCreators.open(key, { text, variant })
	} catch {
		try {
			ToastActionCreators.open({ key, content: text })
		} catch {
			console.error("[Hozy's Ghost]", text)
		}
	}
}

function asDispatcher(value: unknown): AnyRecord | undefined {
	if (!value || typeof value !== 'object') return undefined
	const rec = value as AnyRecord
	if (typeof rec.dispatch === 'function') return rec
	const dflt = rec.default
	if (dflt && typeof dflt === 'object' && typeof (dflt as AnyRecord).dispatch === 'function') {
		return dflt as AnyRecord
	}
	return undefined
}

function firstString(...values: unknown[]): string | undefined {
	for (const v of values) {
		if (typeof v === 'string' && v.trim()) return v.trim()
	}
}

function messageIdOf(action: any): string | undefined {
	return firstString(action?.messageId, action?.message?.id, action?.id)
}

function channelIdOf(action: any): string {
	return firstString(action?.channelId, action?.channel_id, action?.message?.channel_id) ?? ''
}

function contentOf(msg: any): string {
	if (typeof msg?.content === 'string') return msg.content
	if (typeof msg?.text === 'string') return msg.text
	return ''
}

function extractAuthor(msg: any): { author: string; displayName?: string; authorId?: string } {
	const a = msg?.author
	if (!a) return { author: 'Unknown' }
	const username = firstString(a.username, a.name, a.id) ?? 'Unknown'
	const displayName = firstString(
		a.globalName,
		a.global_name,
		a.displayName,
		a.display_name,
		a.nickname,
	)
	const authorId = firstString(a.id)
	return { author: username, displayName, authorId }
}

function extractAttachments(msg: any): AttachmentInfo[] {
	const list: AttachmentInfo[] = []
	const raw: any[] = []
	if (Array.isArray(msg?.attachments)) raw.push(...msg.attachments)
	if (msg?.attachment) raw.push(msg.attachment)
	const flags = Number(msg?.flags ?? 0)
	const isVoiceFlag = Number.isFinite(flags) && (flags & 8192) !== 0
	for (const att of raw) {
		if (!att || typeof att !== 'object') continue
		const url = firstString(att.url, att.proxy_url)
		if (!url) continue
		const filename = firstString(att.filename, att.name, att.fileName) ?? 'attachment'
		const contentType = firstString(att.content_type, att.contentType, att.mimetype) ?? ''
		const audio =
			contentType.toLowerCase().startsWith('audio/') ||
			/\.(ogg|oga|opus|mp3|wav|m4a|webm)$/i.test(filename) ||
			att.duration_secs != null ||
			att.waveform != null ||
			isVoiceFlag
		list.push({ filename, url, contentType, voice: audio ? true : undefined })
	}
	return list
}

function pad(n: number) {
	return n < 10 ? `0${n}` : String(n)
}

function formatDate(at: number): string {
	try {
		const d = new Date(at)
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
	} catch {
		return ''
	}
}

function mediaLabel(attachments: AttachmentInfo[] | undefined, isVoice?: boolean): string {
	if (isVoice) return '🎤 Voice'
	if (!attachments || attachments.length === 0) return ''
	const parts: string[] = []
	for (const a of attachments) {
		if (a.voice) parts.push(`🎤 ${a.filename}`)
		else if ((a.contentType ?? '').toLowerCase().startsWith('image/')) parts.push(`🖼 ${a.filename}`)
		else parts.push(`📎 ${a.filename}`)
	}
	return parts.join(' • ')
}

function extractGuildId(msg: any): string | undefined {
	return firstString(msg?.guild_id, msg?.guildId, msg?.guild?.id)
}

function resolveScope(
	channelId: string,
	guildId: string | undefined,
	msg: any,
): { scope: 'server' | 'dm' | 'group' | 'unknown'; guildId?: string; guildName?: string } {
	// Fast path: guild_id present => server.
	if (guildId) {
		let guildName: string | undefined
		try {
			const [found] = lookupModule(withProps('getGuild'))
			const store: AnyRecord = asStore(found)
			const guild = store?.getGuild?.(guildId)
			guildName = guild?.name ?? guild?.acronym
		} catch {}
		return { scope: 'server', guildId, guildName }
	}
	// Channel lookup fallback for DM/group distinction
	try {
		const [found] = lookupModule(withProps('getChannel'))
		const store: AnyRecord = asStore(found)
		const channel = channelId ? store?.getChannel?.(channelId) : undefined
		const type = channel?.type
		if (type === 3) return { scope: 'group' }
		if (type === 1) return { scope: 'dm' }
		// Guild text/channel without guild_id on the message object
		const cid = channel?.guild_id ?? channel?.guildId
		if (cid) {
			let guildName: string | undefined
			try {
				const [g] = lookupModule(withProps('getGuild'))
				guildName = (asStore(g)?.getGuild?.(cid as string) as any)?.name
			} catch {}
			return { scope: 'server', guildId: cid as string, guildName }
		}
	} catch {}
	// No guild_id and no channel info => assume DM (covers user DMs + group fallback)
	return { scope: 'dm' }
}

function asStore(value: unknown): AnyRecord | undefined {
	if (!value || typeof value !== 'object') return undefined
	const rec = value as AnyRecord
	if (typeof rec.getChannel === 'function' || typeof rec.getGuild === 'function') return rec
	const dflt = rec.default
	if (dflt && typeof dflt === 'object') return dflt as AnyRecord
	return rec
}

function handleAction(action: any) {
	if (!action || typeof action !== 'object') return
	const settings = getSettings()
	const type = String(action.type ?? '')

	// CREATE — remember the message so later edit/delete has its content
	if (type === 'MESSAGE_CREATE') {
		const msg = action.message ?? action.data ?? action
		const id = messageIdOf(action) ?? (msg && typeof msg === 'object' ? firstString(msg.id) : undefined)
		if (!id) return
		const content = contentOf(msg)
		const attachments = extractAttachments(msg)
		// Voice messages have empty content but a voice attachment — still track them
		if (!content && attachments.length === 0) return
		const author = extractAuthor(msg)
		const isVoice = attachments.some(a => a.voice)
		const channelId = channelIdOf(action)
		const scopeInfo = resolveScope(channelId, extractGuildId(msg), msg)
		trackCreate({
			id,
			channelId,
			author: author.author,
			displayName: author.displayName,
			authorId: author.authorId,
			content,
			attachments: attachments.length ? attachments : undefined,
			hasLink: hasLinkIn(content),
			isVoice: isVoice ? true : undefined,
			scope: scopeInfo.scope,
			guildId: scopeInfo.guildId,
			guildName: scopeInfo.guildName,
			at: Date.now(),
		})
		return
	}

	// UPDATE (edit) — log old -> new
	if (type === 'MESSAGE_UPDATE') {
		const msg = action.message ?? action.data ?? action
		const id = messageIdOf(action)
		if (!id) return
		const newContent = contentOf(msg)
		const attachments = extractAttachments(msg)
		// A delete/edit that only changes media (voice/image) still counts
		if (!newContent && attachments.length === 0) return
		const channelId = channelIdOf(action)
		const scopeInfo = resolveScope(channelId, extractGuildId(msg), msg)
		const entry = trackEdit(id, newContent, channelId, {
			attachments: attachments.length ? attachments : undefined,
			hasLink: hasLinkIn(newContent),
			isVoice: attachments.some(a => a.voice) ? true : undefined,
			scope: scopeInfo.scope,
			guildId: scopeInfo.guildId,
			guildName: scopeInfo.guildName,
		})
		if (entry && settings.notifyEdit) {
			const media = mediaLabel(entry.attachments, entry.isVoice)
			showToast(
				'hozy-ghost-edit',
				`✏️ Edited by ${entry.author}: ${(entry.oldContent || media || '(media)').slice(0, 55)}`,
				'default',
			)
		}
		return
	}

	// DELETE — log the last known content
	if (type === 'MESSAGE_DELETE') {
		const id = messageIdOf(action)
		if (!id) return
		const entry = trackDelete(id, channelIdOf(action))
		if (entry && settings.notifyDelete) {
			const media = mediaLabel(entry.attachments, entry.isVoice)
			showToast(
				'hozy-ghost-delete',
				`🗑 Deleted by ${entry.author} ${media ? `(${media}) ` : ''}: ${(entry.oldContent || '(media)').slice(0, 50)}`,
				'default',
			)
		}
		return
	}

	// BULK DELETE — each id was tracked on create
	if (type === 'MESSAGE_DELETE_BULK') {
		const ids: string[] = Array.isArray(action.ids) ? action.ids : []
		for (const id of ids) {
			const entry = trackDelete(String(id), channelIdOf(action))
			if (entry && settings.notifyDelete) {
				showToast(
					'hozy-ghost-delete',
					`🗑 Deleted by ${entry.author}: ${(entry.oldContent || '(media)').slice(0, 50)}`,
					'default',
				)
			}
		}
	}
}

function patchDispatcher(exports: unknown, cleanup: (...fns: Array<() => any>) => void) {
	const dispatcher = asDispatcher(exports)
	if (!dispatcher || typeof dispatcher.dispatch !== 'function') return
	if (seenDispatchers.has(dispatcher)) return
	seenDispatchers.add(dispatcher)

	cleanup(
		instead(dispatcher, 'dispatch', function (this: any, args: any[], original: (...a: any[]) => any) {
			try {
				handleAction(args[0])
			} catch (error) {
				console.error("[Hozy's Ghost] dispatch hook failed:", error)
			}
			return original.apply(this, args)
		}),
	)
}

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		logger.log("Hozy's Ghost Messages started.")
		void getStorage().get()
		void getGhostStorage().get()

		try {
			const [found] = lookupModule(withProps('dispatch', 'isDispatching'))
			if (found) patchDispatcher(found, cleanup)
			// Race fix: dispatcher may load after plugin start — subscribe for late arrivals
			cleanup(
				waitForModules(withProps('dispatch', 'isDispatching'), (exports: unknown) => {
					patchDispatcher(exports, cleanup)
				}),
			)
		} catch (error) {
			console.error("[Hozy's Ghost] initial lookup failed:", error)
		}
	},
	stop({ logger }) {
		logger.log("Hozy's Ghost Messages stopped.")
	},
})
