import { ToastActionCreators } from '@valenced/discord/actions'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { getGhostStorage, trackCreate, trackDelete, trackEdit } from './ghost'
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

function authorOf(msg: any): string {
	const a = msg?.author
	if (!a) return 'Unknown'
	return firstString(a.username, a.name, a.id) ?? 'Unknown'
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
		if (!content) return
		trackCreate({
			id,
			channelId: channelIdOf(action),
			author: authorOf(msg),
			authorId: firstString(msg?.author?.id),
			content,
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
		if (!newContent) return
		const entry = trackEdit(id, newContent, channelIdOf(action))
		if (entry && settings.notifyEdit) {
			showToast(
				'hozy-ghost-edit',
				`✏️ Edited by ${entry.author}: ${entry.oldContent.slice(0, 60)}`,
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
			showToast(
				'hozy-ghost-delete',
				`🗑 Deleted by ${entry.author}: ${entry.oldContent.slice(0, 60)}`,
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
					`🗑 Deleted by ${entry.author}: ${entry.oldContent.slice(0, 60)}`,
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
		} catch (error) {
			console.error("[Hozy's Ghost] initial lookup failed:", error)
		}
	},
	stop({ logger }) {
		logger.log("Hozy's Ghost Messages stopped.")
	},
})
