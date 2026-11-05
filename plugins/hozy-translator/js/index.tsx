import { definePlugin } from '@valenced/plugin'
import { instead } from '@valenced/patcher'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

export default definePlugin({
    start({ cleanup, logger }) {
        logger.log('Hozy Token plugin active.')

        const [MessageActions] = lookupModule(withProps('sendMessage', 'editMessage'))
        const [MessageReceiver] = lookupModule(withProps('receiveMessage'))
        const [AuthStore] = lookupModule(withProps('getToken'))

        if (!MessageActions || !MessageReceiver || !AuthStore) {
            logger.error('Failed to locate Discord modules.')
            return
        }

        cleanup(
            instead(MessageActions, 'sendMessage', (args, original) => {
                const [channelId, message] = args

                if (message?.content?.trim()?.toLowerCase() === '/token') {
                    const token = AuthStore.getToken()

                    MessageReceiver.receiveMessage(channelId, {
                        id: `token_local_${Date.now()}`,
                        type: 0,
                        channel_id: channelId,
                        content: '',
                        embeds: [
                            {
                                title: '🔑 Your Account Token',
                                description: token || 'Token not found.',
                                color: 0x5865F2,
                                footer: {
                                    text: 'Private Plugin • Long press text to copy'
                                }
                            }
                        ],
                        author: {
                            id: '1',
                            username: "Hozy System",
                            discriminator: '0000',
                            avatar: 'clyde'
                        }
                    })

                    return Promise.resolve()
                }

                return original(...args)
            })
        )
    },
    stop({ logger }) {
        logger.log('Hozy Token plugin stopped.')
    }
})
