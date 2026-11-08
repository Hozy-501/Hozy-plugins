import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'

export interface CacheEntry {
	text: string
	language?: string
	providerUsed: string
	at: number
}

export type CacheMap = Record<string, CacheEntry>

const MAX_ENTRIES = 100

let cacheStorage: ReturnType<typeof getJsonStorage<CacheMap>> | undefined

export function getCacheStorage() {
	if (!cacheStorage) {
		cacheStorage = getJsonStorage<CacheMap>(
			pluginStoragePathFor('com.hozy.voice-transcriber', 'cache.json'),
			{ default: {}, load: true },
		)
	}
	return cacheStorage
}

export function cacheKey(messageId: string | undefined, url: string): string {
	const mid = (messageId ?? '').trim() || 'no-id'
	// keep url short but unique — strip query params to stay stable
	const clean = url.split('?')[0] ?? url
	return `${mid}:${clean}`
}

export function getCached(key: string): CacheEntry | undefined {
	try {
		const cache = getCacheStorage().cache as CacheMap | undefined
		return cache?.[key]
	} catch {
		return undefined
	}
}

export function setCached(key: string, entry: CacheEntry) {
	try {
		const storage = getCacheStorage()
		const current = (storage.cache as CacheMap) ?? {}
		const next: CacheMap = { ...current, [key]: entry }

		const keys = Object.keys(next)
		if (keys.length > MAX_ENTRIES) {
			const sorted = keys.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0))
			const keep = new Set(sorted.slice(-MAX_ENTRIES))
			for (const k of keys) {
				if (!keep.has(k)) delete next[k]
			}
		}

		void storage.set(next)
	} catch (error) {
		console.error("[Hozy's Voice Transcriber] cache write failed:", error)
	}
}

export function clearCache() {
	try {
		getCacheStorage().set({})
	} catch {}
}
