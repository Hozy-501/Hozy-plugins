import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'

export interface RecentMessage {
	id: string
	channelId: string
	author: string
	authorId?: string
	content: string
	at: number
}

export interface GhostEntry {
	id: string
	channelId: string
	author: string
	authorId?: string
	type: 'edit' | 'delete'
	oldContent: string
	newContent?: string
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

export function trackEdit(id: string, newContent: string, channelId: string) {
	try {
		const data = getGhostData()
		const prev = data.recent[id]
		if (!prev || !newContent || prev.content === newContent) {
			if (prev && newContent)
				trackCreate({ ...prev, content: newContent, at: Date.now() })
			return
		}
		const entry: GhostEntry = {
			id,
			channelId,
			author: prev.author,
			authorId: prev.authorId,
			type: 'edit',
			oldContent: prev.content,
			newContent,
			at: Date.now(),
		}
		const log = [entry, ...data.log].slice(0, MAX_LOG)
		const recent = { ...data.recent, [id]: { ...prev, content: newContent, at: Date.now() } }
		void getGhostStorage().set({ recent: pruneRecent(recent), log })
		return entry
	} catch (error) {
		console.error("[Hozy's Ghost] trackEdit failed:", error)
	}
}

export function trackDelete(id: string, channelId: string): GhostEntry | undefined {
	try {
		const data = getGhostData()
		const prev = data.recent[id]
		if (!prev) return undefined
		const entry: GhostEntry = {
			id,
			channelId,
			author: prev.author,
			authorId: prev.authorId,
			type: 'delete',
			oldContent: prev.content,
			at: Date.now(),
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
