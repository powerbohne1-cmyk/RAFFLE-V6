# Vanguard Loot Raffle V3

Discord-first Monster Invasion loot raffle with Supabase history. The operational admin interface lives in Discord; the website only displays completed MI result cards.

## V3 features

- Entire bot UI and messages are in English.
- Admin logo shown in the `/raffle` panel on desktop and mobile Discord.
- Loot classes are freely named and use one of four visual colors.
- Fixed raffle display order: 🟥 Red → 🟨 Gold → 🟪 Purple → 🟦 Blue.
- Loot inside each class follows the same color-grouped order.
- Add, edit and delete/remove loot classes.
- Add and delete/remove saved loot items.
- Historical data is preserved automatically: items/classes already used in history are removed from active menus instead of destroying old raffle records.
- Custom cooldown per loot class.
- Cooldown reset for one player or everyone from the Discord admin panel.
- `/cooldown-reset player:@User` or `/cooldown-reset all:true` is also available.
- Admin proxy entries: during an active raffle, use **Active Raffle → Add Proxy**, choose a loot item, then choose **Select @User** or **Enter Name**.
- **Select @User** stores the real Discord user ID, so wins, loot history and cooldowns apply to that actual Discord account.
- **Enter Name** keeps support for manual proxy names. Use the same spelling for the same manual proxy across raffles if you want its proxy cooldown identity to remain consistent.
- Custom raffle title, start text, closing text and entry timer.
- `@everyone` notification when a raffle starts and automatically at 1 minute remaining.
- Players select all loot they want from a dropdown. Loot blocked by an active cooldown is hidden.
- One spin distributes all loot.
- Maximum one win per loot class per player/proxy within the same spin.
- `/cooldown` and `/loothistory`.
- Screenshot loot detection remains available with an OpenAI API key.
- Website stores/displays completed cards as `MI DD.MM.YYYY HH:mm`.

## Railway root directory

If the repository contains the wrapper folder used in the supplied ZIP, use:

`/vanguard-loot-raffle/apps/bot`

If `apps` is at the repository root, use:

`/apps/bot`

## Required environment variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_ADMIN_ROLE_ID=
DISCORD_RAFFLE_CHANNEL_ID=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional screenshot detection:

```env
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-5.4-mini
```

## Supabase

V3 uses the existing V2 database schema. No additional SQL migration is required for proxy entries, deletes/removals, ordering, or cooldown reset.


## V4 upgrade
If upgrading from V3, run `supabase/V4_MIGRATION.sql` once in Supabase before deploying V4. The public raffle message now has a live adaptive countdown and a spinning-wheel animation during the final 10 seconds. Results can include a custom text and automatically ping @everyone.


## V5 upgrade
No Supabase migration is required when upgrading from V4 to V5.

## V6 raffle fairness and draft editing

Before launch, admins can reopen **Edit Loot** as often as needed, add/remove saved loot, adjust quantities, and then press **Start Raffle**. Quantities are preserved for loot that remains selected.

Winner rules:
- One participant can receive a specific loot item only once per raffle, regardless of item quantity.
- A win applies the configured cooldown to the entire loot class (for example Red), not only the exact item.
- That class cooldown does not affect other classes.
- During the same spin, a player who wins from a class is immediately excluded from the remaining loot in that same class.
