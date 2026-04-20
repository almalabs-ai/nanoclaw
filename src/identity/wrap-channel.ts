import { ChannelFactory, ChannelOpts } from '../channels/registry.js';
import { PeopleConfig, resolvePerson, getDefaultIdentity } from './people.js';

export function wrapChannelFactory(
  channelName: string,
  factory: ChannelFactory,
  getPeopleConfig: () => PeopleConfig,
): ChannelFactory {
  return (opts: ChannelOpts) => {
    const originalOnMessage = opts.onMessage;
    const wrappedOpts: ChannelOpts = {
      ...opts,
      onMessage: (chatJid, msg) => {
        // msg.sender is the channel-native user ID (e.g. Slack UID, Telegram user ID)
        const cfg = getPeopleConfig();
        const resolved = resolvePerson(channelName, msg.sender, cfg);
        const identity = resolved ?? getDefaultIdentity(cfg);
        return originalOnMessage(chatJid, {
          ...msg,
          // @ts-ignore — canonical_id added by identity layer; type updated in Task 6
          canonical_id: identity.canonical_id,
          // @ts-ignore — roles added by identity layer; type updated in Task 6
          roles: identity.roles,
        });
      },
    };
    return factory(wrappedOpts);
  };
}
