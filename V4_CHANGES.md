# V4 changes

- Live countdown in the public Discord raffle message.
- Adaptive updates: every 10s normally, every 5s in the last minute, every 1s in the final 10 seconds.
- Final 10 seconds show a spinning wheel animation in the raffle embed.
- New free-form Results text field when creating a raffle.
- Results ping @everyone automatically.
- Existing V3 features remain: English UI, Red → Gold → Purple → Blue ordering, delete loot/classes, cooldown resets, proxy entries.

## V3 → V4 database upgrade
Run `supabase/V4_MIGRATION.sql` once in the Supabase SQL Editor before using V4.
