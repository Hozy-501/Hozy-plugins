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
	const cache = getGhostStorage().cache as GhostData | undefined
	return cache ?? { recent: {}, log: [] }
}

export function ghostKey(entry: GhostEntry): string {
	return entry.key || `${entry.id}:${entry.at}:${entry.type}`
}

export function hasLinkIn(text: string | undefined): boolean {
	if (!text) return false
	return /https?:\/\/|www\./i.test(text)
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
		if (!prev) return undefined
		const newAttachments = extra?.attachments ?? prev.attachments
		const newHasLink = extra?.hasLink ?? hasLinkIn(newContent)
		const newIsVoice = extra?.isVoice ?? prev.isVoice
		const contentChanged = prev.content !== newContent
		const mediaChanged =
			JSON.stringify(prev.attachments ?? []) !== JSON.stringify(newAttachments ?? [])
		if (!contentChanged && !mediaChanged) return undefined
		// Empty content with only-attachment edits still count as media change
		const at = Date.now()
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
