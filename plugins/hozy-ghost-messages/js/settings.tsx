import { Page } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { ScrollView, StyleSheet, View } from 'react-native'
import {
	clearAllGhostData,
	clearGhostLog,
	getGhostData,
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

function formatTime(at: number): string {
	try {
		return new Date(at).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return ''
	}
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS
	const data = getGhostData()
	const log = data.log ?? []

	const notifyDelete = s.notifyDelete ?? true
	const notifyEdit = s.notifyEdit ?? true

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
					title="Saved ghosts"
					description={`${log.length} event(s) saved on this device — they survive app restarts.`}
				>
					{log.length === 0 ? (
						<Design.TableRow
							label="No ghosts yet"
							subLabel="Edited / deleted messages will appear here"
						/>
					) : (
						log.slice(0, 20).map((entry, i) => (
							<View key={`${entry.id}-${entry.at}-${i}`}>
								<Design.TableRow
									label={`${entry.type === 'delete' ? '🗑 Deleted' : '✏️ Edited'} by ${entry.author}`}
									subLabel={`${entry.oldContent.slice(0, 80)}${entry.oldContent.length > 80 ? '…' : ''} • ${formatTime(entry.at)}`}
								/>
								{entry.type === 'edit' && entry.newContent ? (
									<Design.TableRow
										label="→ new:"
										subLabel={`${entry.newContent.slice(0, 80)}${entry.newContent.length > 80 ? '…' : ''}`}
									/>
								) : null}
							</View>
						))
					)}
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
					description="Hozy's Ghost Messages watches MESSAGE_CREATE / MESSAGE_UPDATE / MESSAGE_DELETE and saves the last 500 messages + 200 ghost events on your device. Nothing leaves your device."
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
})
