# V6 changes

- Added an explicit **Edit Loot** button to draft raffles before launch.
- Draft loot dropdown can be reopened repeatedly before **Start Raffle**.
- Re-editing selected loot now preserves quantities for items that remain selected.
- Quantity controls now return to **Edit Loot / Set More Quantities / Start Raffle** instead of becoming a dead end.
- Each participant can win a specific loot item at most once, even when that loot has quantity > 1.
- If there are more copies than unique eligible participants, remaining copies stay unawarded instead of being awarded twice to the same person.
- Class cooldown behavior is explicit and enforced during the same spin:
  - winning any loot in a class applies the cooldown to the entire class;
  - all later loot from that class excludes that player immediately;
  - other loot classes are unaffected.
- Existing V5 proxy, countdown, wheel, result text, @everyone notifications, class order, deletion and cooldown reset features remain unchanged.
