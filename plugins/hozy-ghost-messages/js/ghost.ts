import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'

export interface AttachmentInfo {
	filename: string
	url: string
	contentType?: string
	voice?: boolean
}

export interface RecentMessage {
	id: string
	channelId: string
	author: string
	displayName?: string
	authorId?: string
	content: string
	attachments?: AttachmentInfo[]
	hasLink?: boolean
	isVoice?: boolean
	scope?: 'server' | 'dm' | 'group' | 'unknown'
	guildId?: string
	guildName?: string
	at: number
}

export interface GhostEntry {
	key: string
	id: string
	channelId: string
	author: string
	displayName?: string
	authorId?: string
	type: 'edit' | 'delete'
	oldContent: string
	newContent?: string
	attachments?: AttachmentInfo[]
	hasLink?: boolean
	isVoice?: boolean
	favorite?: boolean
	scope?: 'server' | 'dm' | 'group' | 'unknown'
	guildId?: string
	guildName?: string
	at: number
}

export interface GhostData {
	recent: Record<string, RecentMessage>
	log: GhostEntry[]
}

const MAX_RECENT = 500
const MAX_LOG = 200

let storageInstance: ReturnType<typeof getJsonStorage<GhostData>> | undefined

export function getGhostStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<GhostData>(
			pluginStoragePathFor('com.hozy.ghost-messages', 'ghosts.json'),
			{ default: { recent: {}, log: [] }, load: true },
		)
	}
	return storageInstance
}

export function getGhostData(): GhostData {
	const raw = getGhostStorage().cache as any
	if (!raw) return { recent: {}, log: [] }
	if (Array.isArray(raw)) return { recent: {}, log: raw }
	return {
		recent: raw.recent ?? {},
		log: Array.isArray(raw.log) ? raw.log : [],
	}
}

export function ghostKey(entry: GhostEntry): string {
	return entry.key || `${entry.id}:${entry.at}:${entry.type}`
}

export function hasLinkIn(text: string | undefined): boolean {
	if (!text) return false
	return /https?:\/\/|www\./i.test(text)
}

function pad(n: number) {
	return n < 10 ? `0${n}` : String(n)
}

function formatDateTime(at: number): string {
	try {
		const d = new Date(at)
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
	} catch {
		return ''
	}
}

function pruneRecent(recent: Record<string, RecentMessage>) {
	const keys = Object.keys(recent)
	if (keys.length <= MAX_RECENT) return recent
	const sorted = keys.sort((a, b) => (recent[a]?.at ?? 0) - (recent[b]?.at ?? 0))
	const keep = new Set(sorted.slice(-MAX_RECENT))
	const next: Record<string, RecentMessage> = {}
	for (const k of keys) if (keep.has(k)) next[k] = recent[k]
	return next
}

export function trackCreate(entry: RecentMessage) {
	try {
		const data = getGhostData()
		const recent = { ...data.recent, [entry.id]: entry }
		const pruned = pruneRecent(recent)
		void getGhostStorage().set({ recent: pruned, log: data.log })
	} catch (error) {
		console.error("[Hozy's Ghost] trackCreate failed:", error)
	}
}

export interface TrackEditExtra {
	attachments?: AttachmentInfo[]
	hasLink?: boolean
	isVoice?: boolean
	scope?: 'server' | 'dm' | 'group' | 'unknown'
	guildId?: string
	guildName?: string
}

export function trackEdit(
	id: string,
	newContent: string,
	channelId: string,
	extra?: TrackEditExtra,
) {
	try {
		const data = getGhostData()
		const prev = data.recent[id]
		const at = Date.now()
		if (!prev) {
			// Message seen before tracking started (or cache miss) — still log it
			// so the new content isn't lost for deletes/edits after reloads.
			const attachments = extra?.attachments
			if (!newContent && !attachments?.length) return undefined
			const entry: GhostEntry = {
				key: `${id}:${at}:edit`,
				id,
				channelId,
				author: 'Unknown (before tracking)',
				type: 'edit',
				oldContent: '(original not tracked)',
				newContent,
				attachments,
				hasLink: extra?.hasLink ?? hasLinkIn(newContent),
				isVoice: extra?.isVoice,
				favorite: false,
				scope: extra?.scope,
				guildId: extra?.guildId,
				guildName: extra?.guildName,
				at,
			}
			const log = [entry, ...data.log].slice(0, MAX_LOG)
			const recent = {
				...data.recent,
				[id]: {
					id,
					channelId,
					author: entry.author,
					content: newContent,
					attachments,
					hasLink: entry.hasLink,
					isVoice: entry.isVoice,
					scope: extra?.scope,
					guildId: extra?.guildId,
					guildName: extra?.guildName,
					at,
				} as RecentMessage,
			}
			void getGhostStorage().set({ recent: pruneRecent(recent), log })
			return entry
		}
		const newAttachments = extra?.attachments ?? prev.attachments
		const newHasLink = extra?.hasLink ?? hasLinkIn(newContent)
		const newIsVoice = extra?.isVoice ?? prev.isVoice
		const contentChanged = prev.content !== newContent
		const mediaChanged =
			JSON.stringify(prev.attachments ?? []) !== JSON.stringify(newAttachments ?? [])
		if (!contentChanged && !mediaChanged) return undefined
		const entry: GhostEntry = {
			key: `${id}:${at}:edit`,
			id,
			channelId,
			author: prev.author,
			displayName: prev.displayName,
			authorId: prev.authorId,
			type: 'edit',
			oldContent: prev.content,
			newContent,
			attachments: prev.attachments,
			hasLink: prev.hasLink,
			isVoice: prev.isVoice,
			favorite: false,
			scope: extra?.scope ?? prev.scope,
			guildId: extra?.guildId ?? prev.guildId,
			guildName: extra?.guildName ?? prev.guildName,
			at,
		}
		const log = [entry, ...data.log].slice(0, MAX_LOG)
		const recent = {
			...data.recent,
			[id]: {
				...prev,
				content: newContent,
				attachments: newAttachments,
				hasLink: newHasLink,
				isVoice: newIsVoice,
				at,
			},
		}
		void getGhostStorage().set({ recent: pruneRecent(recent), log })
		return entry
	} catch (error) {
		console.error("[Hozy's Ghost] trackEdit failed:", error)
		return undefined
	}
}

export function trackDelete(id: string, channelId: string): GhostEntry | undefined {
	try {
		const data = getGhostData()
		const prev = data.recent[id]
		if (!prev) return undefined
		const at = Date.now()
		const entry: GhostEntry = {
			key: `${id}:${at}:delete`,
			id,
			channelId,
			author: prev.author,
			displayName: prev.displayName,
			authorId: prev.authorId,
			type: 'delete',
			oldContent: prev.content,
			attachments: prev.attachments,
			hasLink: prev.hasLink,
			isVoice: prev.isVoice,
			favorite: false,
			scope: prev.scope,
			guildId: prev.guildId,
			guildName: prev.guildName,
			at,
		}
		const recent = { ...data.recent }
		delete recent[id]
		const log = [entry, ...data.log].slice(0, MAX_LOG)
		void getGhostStorage().set({ recent, log })
		return entry
	} catch (error) {
		console.error("[Hozy's Ghost] trackDelete failed:", error)
		return undefined
	}
}

export function toggleFavorite(key: string) {
	try {
		const data = getGhostData()
		const log = data.log.map(entry =>
			ghostKey(entry) === key ? { ...entry, favorite: !entry.favorite } : entry,
		)
		void getGhostStorage().set({ recent: data.recent, log })
	} catch (error) {
		console.error("[Hozy's Ghost] toggleFavorite failed:", error)
	}
}

export function clearGhostLog() {
	try {
		const data = getGhostData()
		void getGhostStorage().set({ recent: data.recent, log: [] })
	} catch {}
}

export function clearAllGhostData() {
	try {
		getGhostStorage().set({ recent: {}, log: [] })
	} catch {}
}

// ---------- Export / Import (backup mover: JSON + human TXT/MD) ----------

export type ExportFormat = 'json' | 'txt' | 'md'

function mediaText(
	attachments: AttachmentInfo[] | undefined,
	isVoice?: boolean,
): string {
	if (isVoice) return 'Voice'
	if (!attachments?.length) return ''
	return attachments.map(a => `${a.voice ? '🎤' : '📎'} ${a.filename}`).join(', ')
}

export function exportGhosts(format: ExportFormat): string {
	const data = getGhostData()
	const log = [...data.log].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
	if (format === 'json') {
		return JSON.stringify(
			{ version: 2, exportedAt: Date.now(), recent: data.recent, log },
			null,
			2,
		)
	}
	if (format === 'md') {
		const lines: string[] = [
			'# Hozy\'s Ghost Messages — Export',
			`Exported: ${new Date().toISOString()}`,
			`Events: ${log.length}`,
			'',
		]
		for (const e of log) {
			const author = e.displayName ? `${e.displayName} (@${e.author})` : `@${e.author}`
			const loc = e.scope === 'server' ? `🏢 ${e.guildName ?? e.guildId ?? 'Server'}` : '💬 DM'
			lines.push(`## ${e.type === 'delete' ? '🗑 Deleted' : '✏️ Edited'} — ${author} • ${loc}`)
			lines.push(`- Date: ${formatDateTime(e.at)} • Msg: ${e.id} • Channel: ${e.channelId || '-'}`)
			if (mediaText(e.attachments, e.isVoice))
				lines.push(`- Media: ${mediaText(e.attachments, e.isVoice)}`)
			lines.push(`- Old: ${e.oldContent || '(media only)'}`)
			if (e.type === 'edit' && e.newContent) lines.push(`- New: ${e.newContent}`)
			lines.push('')
		}
		return lines.join('\n')
	}
	// txt
	const lines: string[] = [
		"Hozy's Ghost Messages — Export",
		`Exported: ${new Date().toISOString()}`,
		`Events: ${log.length}`,
		'',
	]
	for (const e of log) {
		const author = e.displayName ? `${e.displayName} (@${e.author})` : `@${e.author}`
		const loc = e.scope === 'server' ? `🏢 ${e.guildName ?? e.guildId ?? 'Server'}` : '💬 DM'
		lines.push(`[${formatDateTime(e.at)}] [${e.type.toUpperCase()}] ${author} • ${loc}`)
		lines.push(`  Msg: ${e.id}  Channel: ${e.channelId || '-'}`)
		if (mediaText(e.attachments, e.isVoice)) lines.push(`  Media: ${mediaText(e.attachments, e.isVoice)}`)
		lines.push(`  Old: ${e.oldContent || '(media only)'}`)
		if (e.type === 'edit' && e.newContent) lines.push(`  New: ${e.newContent}`)
		lines.push('')
	}
	return lines.join('\n')
}

export interface ImportResult {
	ok: boolean
	count?: number
	error?: string
}

export function importGhosts(jsonStr: string): ImportResult {
	try {
		const raw = JSON.parse(jsonStr)
		const logInput: any[] = Array.isArray(raw)
			? raw
			: Array.isArray(raw?.log)
				? raw.log
				: []
		if (logInput.length === 0) return { ok: false, error: 'No entries found in this backup.' }
		const data = getGhostData()
		const existingKeys = new Set(data.log.map(e => ghostKey(e)))
		const fresh: GhostEntry[] = []
		const at = Date.now()
		for (const item of logInput) {
			if (!item || typeof item !== 'object') continue
			const id = typeof item.id === 'string' ? item.id : ''
			const type = item.type === 'delete' ? 'delete' : 'edit'
			const oldContent = typeof item.oldContent === 'string' ? item.oldContent : ''
			const ts = typeof item.at === 'number' ? item.at : at
			const entry: GhostEntry = {
				key: typeof item.key === 'string' && item.key ? item.key : `${id || 'imported'}:${ts}:${type}`,
				id,
				channelId: typeof item.channelId === 'string' ? item.channelId : '',
				author: typeof item.author === 'string' ? item.author : 'Unknown',
				displayName: typeof item.displayName === 'string' ? item.displayName : undefined,
				authorId: typeof item.authorId === 'string' ? item.authorId : undefined,
				type,
				oldContent,
				newContent: typeof item.newContent === 'string' ? item.newContent : undefined,
				attachments: Array.isArray(item.attachments) ? item.attachments : undefined,
				hasLink: Boolean(item.hasLink),
				isVoice: Boolean(item.isVoice),
				favorite: Boolean(item.favorite),
				scope: item.scope === 'server' || item.scope === 'dm' || item.scope === 'group' ? item.scope : 'unknown',
				guildId: typeof item.guildId === 'string' ? item.guildId : undefined,
				guildName: typeof item.guildName === 'string' ? item.guildName : undefined,
				at: ts,
			}
			const k = ghostKey(entry)
			if (existingKeys.has(k)) continue
			existingKeys.add(k)
			fresh.push(entry)
		}
		if (fresh.length === 0)
			return { ok: false, error: 'All entries are already in your archive.' }
		// Also restore recent cache if present (so deletes after import still work)
		const recentInput: Record<string, RecentMessage> | undefined =
			raw && typeof raw === 'object' && !Array.isArray(raw) && raw.recent && typeof raw.recent === 'object'
				? raw.recent
				: undefined
		const mergedRecent: Record<string, RecentMessage> = {
			...data.recent,
			...(recentInput ?? {}),
		}
		const mergedLog = [...fresh, ...data.log]
			.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
			.slice(0, MAX_LOG)
		void getGhostStorage().set({ recent: pruneRecent(mergedRecent), log: mergedLog })
		return { ok: true, count: fresh.length }
	} catch (error) {
		return { ok: false, error: 'Invalid backup — expect JSON from Export as JSON.' }
	}
}
