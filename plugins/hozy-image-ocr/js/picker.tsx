import { SearchInput } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { useMemo, useState } from 'react'
import {
	FlatList,
	Modal,
	StyleSheet,
	TouchableOpacity,
	View,
} from 'react-native'
import type { LanguageItem } from './languages'

interface LanguagePickerProps {
	visible: boolean
	title: string
	languages: LanguageItem[]
	selectedCode: string
	onSelect: (code: string) => void
	onClose: () => void
}

export function LanguagePickerModal({
	visible,
	title,
	languages,
	selectedCode,
	onSelect,
	onClose,
}: LanguagePickerProps) {
	const [query, setQuery] = useState('')

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return languages
		return languages.filter(
			l => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
		)
	}, [languages, query])

	return (
		<Modal
			visible={visible}
			animationType="slide"
			transparent
			onRequestClose={onClose}
		>
			<View style={styles.overlay}>
				<View style={styles.sheet}>
					<View style={styles.header}>
						<Design.Text variant="heading-lg/semibold" style={styles.title}>
							{title}
						</Design.Text>
						<TouchableOpacity onPress={onClose} style={styles.closeBtn}>
							<Design.Text
								variant="text-md/medium"
								style={styles.closeTxt}
								children="Close"
							/>
						</TouchableOpacity>
					</View>

					<View style={styles.searchWrap}>
						<SearchInput
							placeholder="Search languages..."
							onChange={setQuery}
						/>
					</View>

					<FlatList
						data={filtered}
						keyExtractor={item => item.code}
						keyboardShouldPersistTaps="handled"
						contentContainerStyle={styles.list}
						renderItem={({ item }) => {
							const active = item.code === selectedCode
							return (
								<TouchableOpacity
									style={[styles.row, active && styles.rowActive]}
									onPress={() => {
										onSelect(item.code)
										onClose()
									}}
								>
									<View style={styles.rowText}>
										<Design.Text
											variant="text-md/medium"
											style={[styles.rowName, active && styles.rowNameActive]}
										>
											{item.name}
										</Design.Text>
										<Design.Text
											variant="text-sm/normal"
											style={styles.rowCode}
										>
											{item.code}
										</Design.Text>
									</View>
									{active && (
										<Design.Text
											variant="text-md/bold"
											style={styles.check}
											children="✓"
										/>
									)}
								</TouchableOpacity>
							)
						}}
					/>
				</View>
			</View>
		</Modal>
	)
}

const styles = StyleSheet.create({
	overlay: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.65)',
		justifyContent: 'flex-end',
	},
	sheet: {
		backgroundColor: '#1e1f22',
		borderTopLeftRadius: 18,
		borderTopRightRadius: 18,
		maxHeight: '85%',
		minHeight: '55%',
		paddingBottom: 24,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 14,
		borderBottomWidth: 1,
		borderBottomColor: '#2b2d31',
	},
	title: { color: '#ffffff' },
	closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
	closeTxt: { color: '#5865f2' },
	searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
	list: { paddingHorizontal: 12, paddingBottom: 16 },
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 12,
		paddingHorizontal: 14,
		borderRadius: 8,
		marginVertical: 2,
		backgroundColor: '#2b2d31',
	},
	rowActive: {
		backgroundColor: '#35373c',
		borderLeftWidth: 4,
		borderLeftColor: '#5865f2',
	},
	rowText: { flex: 1 },
	rowName: { color: '#dbdee1' },
	rowNameActive: { color: '#5865f2', fontWeight: 'bold' },
	rowCode: { color: '#949ba4', marginTop: 2 },
	check: { color: '#5865f2', marginLeft: 8 },
})
