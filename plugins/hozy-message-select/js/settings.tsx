import { Page } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { getJsonStorage, pluginStoragePathFor } from '@valenced/json-storage'
import { ScrollView, StyleSheet } from 'react-native'

export interface SelectSettings {
	confirmDelete: boolean
	showProgress: boolean
	delayMs: number
}

export const DEFAULT_SETTINGS: SelectSettings = {
	confirmDelete: true,
	showProgress: true,
	delayMs: 1000,
}

const DELAY_OPTIONS = [500, 750, 1000, 1500, 2000]

let storageInstance:
	| ReturnType<typeof getJsonStorage<SelectSettings>>
	| undefined

export function getStorage() {
	if (!storageInstance) {
		storageInstance = getJsonStorage<SelectSettings>(
			pluginStoragePathFor('com.hozy.message-select', 'settings.json'),
			{ default: DEFAULT_SETTINGS, load: true },
		)
	}
	return storageInstance
}

export function getSettings(): SelectSettings {
	const cached = getStorage().cache as Partial<SelectSettings> | undefined
	const delay = Number(cached?.delayMs ?? DEFAULT_SETTINGS.delayMs)
	return {
		...DEFAULT_SETTINGS,
		...cached,
		delayMs: Number.isFinite(delay)
			? Math.max(300, Math.min(5000, delay || DEFAULT_SETTINGS.delayMs))
			: DEFAULT_SETTINGS.delayMs,
	}
}

export function SettingsComponent(_props?: { api?: unknown }) {
	const storage = getStorage()
	const s = storage.use() ?? DEFAULT_SETTINGS

	const confirmDelete = s.confirmDelete ?? true
	const showProgress = s.showProgress ?? true
	const delayMs = s.delayMs ?? DEFAULT_SETTINGS.delayMs

	const cycleDelay = () => {
		const index = DELAY_OPTIONS.indexOf(delayMs)
		const next = DELAY_OPTIONS[(index + 1) % DELAY_OPTIONS.length]
		storage.set({ delayMs: next })
	}

	return (
		<Page>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={true}
			>
				<Design.TableRowGroup title="Deletion">
					<Design.TableSwitchRow
						label="Confirm before deleting"
						subLabel="Show a summary and ask before deleting the selected messages."
						value={confirmDelete}
						onValueChange={value => storage.set({ confirmDelete: value })}
					/>
					<Design.TableSwitchRow
						label="Progress toast"
						subLabel="Show progress while messages are being deleted."
						value={showProgress}
						onValueChange={value => storage.set({ showProgress: value })}
					/>
					<Design.TableRow
						label="Delay between deletions"
						subLabel={`${delayMs} ms — tap to change`}
						arrow
						onPress={cycleDelay}
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup
					title="How to use"
					description="Select messages from the long-press menu, then delete them all at once. Selection is per channel and stays in memory only."
				>
					<Design.TableRow
						label="1. Long-press a message"
						subLabel="Choose Select message."
					/>
					<Design.TableRow
						label="2. Select more messages"
						subLabel="Long-press each one and choose Select message."
					/>
					<Design.TableRow
						label="3. Delete them together"
						subLabel="Long-press any message and choose Delete N selected."
					/>
				</Design.TableRowGroup>

				<Design.TableRowGroup title="Good to know">
					<Design.TableRow
						label="Max selection"
						subLabel="100 messages per channel."
					/>
					<Design.TableRow
						label="Temporary selection"
						subLabel="Clears when Discord restarts or the plugin is disabled."
					/>
					<Design.TableRow
						label="Rate limits"
						subLabel="Deletion pauses automatically if Discord asks to slow down."
					/>
				</Design.TableRowGroup>
			</ScrollView>
		</Page>
	)
}

const styles = StyleSheet.create({
	scroll: { flex: 1 },
	scrollContent: { paddingBottom: 48 },
})
