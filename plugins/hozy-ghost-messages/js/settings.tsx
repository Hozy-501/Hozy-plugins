import { Page } from '@valenced/components'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { useMemo, useState } from 'react'
import {
	ScrollView,
	StyleSheet,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import {
	clearAllGhostData,
	clearGhostLog,
	exportGhosts,
	type ExportFormat,
	type GhostEntry,
	getGhostStorage,
	ghostKey,
	importGhosts,
	toggleFavorite,
} from './ghost'

export interface GhostSettings {
	notifyDelete: boolean
	notifyEdit: boolean
}

export const DEFAULT_SETTINGS: GhostSettings = {
	notifyDelete: true,
	notifyEdit: true,
}

let storageInstance: ReturnType<typeof getJsonStorage<GhostSettings>> | undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<GhostSettings>(
			pluginStoragePathFor('com.hozy.ghost-messages', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): GhostSettings {
	return {
		...DEFAULT_SETTINGS,
		...(getStorage().cache as Partial<GhostSettings> | undefined),
	}
}

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

function copyToClipboard(text: string) {
	try {
		const [clip] = lookupModule(withProps('setString', 'getString'))
		const api: any = clip as any
		const setFn =
			typeof api?.setString === 'function'
				? api.setString
				: api?.default && typeof api.default.setString === 'function'
					? api.default.setString
					: null
		if (setFn) {
			setFn.call(api?.default ?? api, text)
			return true
		}
	} catch {}
	return false
}

function doExport(format: ExportFormat) {
	const text = exportGhosts(format)
	const label = format.toUpperCase()
	if (!text || text.trim().length < 20) {
		showToast('hozy-ghost-export', 'Nothing to export yet.', 'critical')
		return
	}
	const ok = copyToClipboard(text)
	showToast(
		'hozy-ghost-export',
		ok ? `Exported as ${label} (${text.length} chars) — copied!` : `Exported as ${label} (${text.length} chars)`,
		ok ? 'success' : 'default',
	)
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

function mediaText(entry: GhostEntry): string {
	if (entry.isVoice) return '🎤 Voice'
	if (!entry.attachments?.length) return ''
	return entry.attachments.map(a => (a.voice ? `🎤 ${a.filename}` : `📎 ${a.filename}`)).join(' • ')
}

interface AuthorGroup {
	authorId: string
	author: string
	displayName?: string
	entries: GhostEntry[]
	latest: number
	favorites: number
}

const FILTERS = [
	{ id: 'edit', label: '✏️ Edits' },
	{ id: 'delete', label: '🗑 Deletes' },
	{ id: 'media', label: '🖼 Media' },
	{ id: 'voice', label: '🎤 Voice' },
	{ id: 'link', label: '🔗 Links' },
	{ id: 'fav', label: '⭐ Favorites' },
] as const

type FilterId = (typeof FILTERS)[number]['id']

function matchesFilters(entry: GhostEntry, filters: Set<FilterId>): boolean {
	if (filters.size === 0) return true
	for (const f of filters) {
		if (f === 'edit' && entry.type === 'edit') return true
		if (f === 'delete' && entry.type === 'delete') return true
		if (f === 'media' && (entry.attachments?.length ?? 0) > 0) return true
		if (f === 'voice' && (entry.isVoice || entry.attachments?.some(a => a.voice))) return true
		if (f === 'link' && entry.hasLink) return true
		if (f === 'fav' && entry.favorite) return true
	}
	return false
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const ghostData = getGhostStorage().use() ?? { recent: {}, log: [] }
	const [search, setSearch] = useState('')
	const [filters, setFilters] = useState<Set<FilterId>>(new Set())
	const [expanded, setExpanded] = useState<string | null>(null)
	const [importOpen, setImportOpen] = useState(false)
	const [importText, setImportText] = useState('')

	const notifyDelete = s.notifyDelete ?? true
	const notifyEdit = s.notifyEdit ?? true
	const log = (ghostData as { log?: GhostEntry[] }).log ?? []

	const toggleFilter = (id: FilterId) => {
		setFilters(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const doImport = () => {
		const result = importGhosts(importText)
		if (result.ok) {
			showToast('hozy-ghost-import', `Imported ${result.count} entries ✓`, 'success')
			setImportText('')
			setImportOpen(false)
		} else {
			showToast('hozy-ghost-import', result.error ?? 'Import failed.', 'critical')
		}
	}

	const groups = useMemo<AuthorGroup[]>(() => {
		const q = search.trim().toLowerCase()
		const map = new Map<string, AuthorGroup>()
		for (const entry of log) {
			if (!matchesFilters(entry, filters)) continue
			if (q) {
				const hay = `${entry.author} ${entry.displayName ?? ''} ${entry.oldContent} ${entry.newContent ?? ''}`.toLowerCase()
				if (!hay.includes(q)) continue
			}
			const key = entry.authorId || entry.author
			const existing = map.get(key)
			if (existing) {
				existing.entries.push(entry)
				existing.latest = Math.max(existing.latest, entry.at)
				if (entry.favorite) existing.favorites += 1
				if (!existing.displayName && entry.displayName) existing.displayName = entry.displayName
			} else {
				map.set(key, {
					authorId: key,
					author: entry.author,
					displayName: entry.displayName,
					entries: [entry],
					latest: entry.at,
					favorites: entry.favorite ? 1 : 0,
				})
			}
		}
		return [...map.values()]
			.map(g => ({ ...g, entries: [...g.entries].sort((a, b) => b.at - a.at) }))
			.sort((a, b) => b.latest - a.latest)
	}, [log, search, filters])

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="Alerts">
					<Design.TableRow
						label="Notify on delete"
						subLabel={notifyDelete ? 'ON' : 'OFF'}
						arrow
						onPress={() => storage.set({ notifyDelete: !notifyDelete })}
					/>
					<Design.TableRow
						label="Notify on edit"
						subLabel={notifyEdit ? 'ON' : 'OFF'}
						arrow
						onPress={() => storage.set({ notifyEdit: !notifyEdit })}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="Archive — by person"
					description="Search by username or nickname, tap a person to open their archive."
				>
					<View style={styles.searchWrap}>
						<TextInput
							value={search}
							onChangeText={setSearch}
							placeholder="Search username, nickname or text…"
							placeholderTextColor="#949ba4"
							autoCapitalize="none"
							autoCorrect={false}
							style={styles.search}
						/>
					</View>
					<View style={styles.chips}>
						{FILTERS.map(f => {
							const active = filters.has(f.id)
							return (
								<TouchableOpacity
									key={f.id}
									style={[styles.chip, active && styles.chipActive]}
									onPress={() => toggleFilter(f.id)}
								>
									<Design.Text
										variant="text-sm/medium"
										style={[styles.chipTxt, active && styles.chipTxtActive]}
									>
										{f.label}
									</Design.Text>
								</TouchableOpacity>
							)
						})}
						{filters.size > 0 ? (
							<TouchableOpacity
								style={[styles.chip, styles.chipClear]}
								onPress={() => setFilters(new Set())}
							>
								<Design.Text variant="text-sm/medium" style={styles.chipTxt}>
									Clear ✕
								</Design.Text>
							</TouchableOpacity>
						) : null}
					</View>

					{groups.length === 0 ? (
						<Design.TableRow
							label="No ghosts match"
							subLabel="Try clearing search / filters"
						/>
					) : (
						groups.map(group => {
							const isOpen = expanded === group.authorId
							const header = group.displayName
								? `${group.displayName}  @${group.author}`
								: `@${group.author}`
							return (
								<View key={group.authorId}>
									<TouchableOpacity
										style={styles.authorHeader}
										onPress={() => setExpanded(isOpen ? null : group.authorId)}
									>
										<Design.Text variant="text-md/medium" style={styles.authorName}>
											{isOpen ? '▾' : '▸'} {header}
										</Design.Text>
										<Design.Text variant="text-sm/normal" style={styles.authorMeta}>
											{group.entries.length} ghost(s) • {group.favorites} ⭐
										</Design.Text>
									</TouchableOpacity>
									{isOpen
										? group.entries.map(entry => (
												<View key={ghostKey(entry)} style={styles.entryCard}>
													<View style={styles.entryTop}>
														<TouchableOpacity
															style={styles.starBtn}
															onPress={() => toggleFavorite(ghostKey(entry))}
														>
															<Design.Text variant="text-md/medium">
																{entry.favorite ? '⭐' : '☆'}
															</Design.Text>
														</TouchableOpacity>
														<Design.Text variant="text-sm/medium" style={styles.entryType}>
															{entry.type === 'delete' ? '🗑 Deleted' : '✏️ Edited'}
														</Design.Text>
														<Design.Text variant="text-sm/normal" style={styles.entryDate}>
															{formatDate(entry.at)}
														</Design.Text>
													</View>
													{entry.oldContent ? (
														<Design.Text variant="text-sm/normal" selectable style={styles.entryBody}>
															{entry.oldContent}
														</Design.Text>
													) : null}
													{entry.type === 'edit' && entry.newContent ? (
														<Design.Text variant="text-sm/normal" selectable style={styles.entryNew}>
															→ {entry.newContent}
														</Design.Text>
													) : null}
													{mediaText(entry) ? (
														<Design.Text variant="text-sm/normal" selectable style={styles.entryMedia}>
															{mediaText(entry)}
															{entry.attachments?.[0]?.url ? ` • ${entry.attachments[0].url.slice(0, 60)}…` : ''}
														</Design.Text>
													) : null}
												</View>
											))
										: null}
								</View>
							)
						})
					)}
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="Backup"
					description="Export copies your archive to the clipboard. Import restores a JSON backup (duplicates are skipped)."
				>
					<View style={styles.chips}>
						<TouchableOpacity style={styles.chip} onPress={() => doExport('json')}>
							<Design.Text variant="text-sm/medium" style={styles.chipTxt}>
								Export JSON
							</Design.Text>
						</TouchableOpacity>
						<TouchableOpacity style={styles.chip} onPress={() => doExport('txt')}>
							<Design.Text variant="text-sm/medium" style={styles.chipTxt}>
								Export TXT
							</Design.Text>
						</TouchableOpacity>
						<TouchableOpacity style={styles.chip} onPress={() => doExport('md')}>
							<Design.Text variant="text-sm/medium" style={styles.chipTxt}>
								Export MD
							</Design.Text>
						</TouchableOpacity>
					</View>
					<Design.TableRow
						label="Import backup (JSON)"
						subLabel={importOpen ? 'Tap again to close' : 'Paste a JSON backup to restore'}
						arrow
						onPress={() => setImportOpen(v => !v)}
					/>
					{importOpen ? (
						<View>
							<View style={styles.searchWrap}>
								<TextInput
									value={importText}
									onChangeText={setImportText}
									placeholder="Paste JSON backup here…"
									placeholderTextColor="#949ba4"
									autoCapitalize="none"
									autoCorrect={false}
									multiline
									style={[styles.search, styles.importBox]}
								/>
							</View>
							<TouchableOpacity style={styles.importBtn} onPress={doImport}>
								<Design.Text variant="text-sm/medium" style={styles.chipTxtActive}>
									Import now
								</Design.Text>
							</TouchableOpacity>
						</View>
					) : null}
				</Design.TableRowGroup>

				<Design.TableRowGroup title="Data">
					<Design.TableRow
						label="Clear ghost log"
						subLabel="Removes saved edits/deletes (keeps tracking)"
						arrow
						onPress={() => clearGhostLog()}
					/>
					<Design.TableRow
						label="Clear everything"
						subLabel="Removes log + message cache"
						arrow
						onPress={() => clearAllGhostData()}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="How it works"
					description="Hozy's Ghost Messages watches MESSAGE_CREATE / MESSAGE_UPDATE / MESSAGE_DELETE and saves the last 500 messages + 200 ghost events on your device. Nothing leaves your device. Voice/media links are stored as metadata (links can expire)."
				>
					<Design.TableRow label="Ghost Messages" subLabel="Local only" />
				</Design.TableRowGroup>
			</ScrollView>
		</Page>
	)
}

const styles = StyleSheet.create({
	scroll: { flex: 1 },
	scrollContent: { paddingBottom: 48 },
	searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
	search: {
		backgroundColor: '#1e1f22',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		color: '#ffffff',
		fontSize: 14,
		borderWidth: 1,
		borderColor: '#2b2d31',
	},
	importBox: { minHeight: 120, textAlignVertical: 'top' },
	importBtn: {
		backgroundColor: '#5865f2',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		marginHorizontal: 16,
		marginBottom: 8,
		alignItems: 'center',
	},
	chips: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		paddingHorizontal: 12,
		paddingVertical: 4,
	},
	chip: {
		backgroundColor: '#2b2d31',
		borderRadius: 16,
		paddingHorizontal: 10,
		paddingVertical: 6,
		margin: 2,
	},
	chipActive: { backgroundColor: '#5865f2' },
	chipClear: { backgroundColor: '#35373c' },
	chipTxt: { color: '#dbdee1' },
	chipTxtActive: { color: '#ffffff' },
	authorHeader: {
		paddingHorizontal: 16,
		paddingVertical: 10,
	},
	authorName: { color: '#ffffff' },
	authorMeta: { color: '#949ba4', marginTop: 2 },
	entryCard: {
		marginHorizontal: 12,
		marginVertical: 4,
		padding: 10,
		backgroundColor: '#1e1f22',
		borderRadius: 8,
	},
	entryTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
	starBtn: { paddingHorizontal: 4, paddingVertical: 2, marginRight: 6 },
	entryType: { color: '#dbdee1' },
	entryDate: { color: '#949ba4', marginLeft: 8, flex: 1, textAlign: 'right' },
	entryBody: { color: '#dbdee1' },
	entryNew: { color: '#b5bac1', marginTop: 4 },
	entryMedia: { color: '#949ba4', marginTop: 4 },
})
