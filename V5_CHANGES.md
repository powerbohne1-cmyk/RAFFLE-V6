# V5 changes

## Proxy entries: real Discord account or manual name

When an admin uses **Active Raffle → Add Proxy** and chooses the loot, V5 now offers two clear options:

- **Select @User** — choose a real Discord user. The raffle entry stores that user's real Discord ID. If the proxy wins, loot history and the loot-class cooldown are applied to the real Discord account, so `/cooldown` works normally for that player.
- **Enter Name** — enter any manual proxy name for an absent player who cannot be selected with an @ mention. Manual-name proxies continue to use a stable `proxy:<name>` internal ID, so the same spelling can retain cooldown behavior across raffles.

No database migration is required for V5. It reuses the existing `raffle_entries.discord_user_id` and `discord_display_name` fields.
