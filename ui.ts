import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

export const colorHex: Record<string, number> = {
  red: 0xEB5757,
  gold: 0xF2C94C,
  purple: 0x9B51E0,
  blue: 0x2F80ED,
};
export const colorEmoji: Record<string, string> = { red:'🟥', gold:'🟨', purple:'🟪', blue:'🟦' };
export const colorOrder: Record<string, number> = { red:0, gold:1, purple:2, blue:3 };

export function sortByColor<T extends { loot_classes?: { color?: string } | null }>(items:T[]):T[] {
  return [...items].sort((a:any,b:any) => {
    const ac = colorOrder[a.loot_classes?.color] ?? 99;
    const bc = colorOrder[b.loot_classes?.color] ?? 99;
    if (ac !== bc) return ac - bc;
    return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
}

export function adminHome() {
  const embed = new EmbedBuilder()
    .setTitle('🎁 Vanguard Loot Raffle')
    .setDescription('Choose what you want to manage.')
    .setThumbnail('attachment://book-of-randy.png');
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin:create').setLabel('Create Raffle').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:active').setLabel('Active Raffle').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:loot').setLabel('Loot Settings').setEmoji('📦').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin:history').setLabel('History').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:cooldowns').setLabel('Cooldowns').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds:[embed], components:[row1,row2] };
}

export function lootSettingsHome() {
  const embed = new EmbedBuilder().setTitle('📦 Loot Settings').setDescription('Manage saved loot and loot classes directly in Discord.');
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('loot:list').setLabel('Loot Items').setEmoji('🎁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('class:list').setLabel('Loot Classes').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('loot:add').setLabel('Add Loot').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('loot:delete').setLabel('Delete Loot').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('class:add').setLabel('Add Class').setEmoji('➕').setStyle(ButtonStyle.Success),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('class:edit').setLabel('Edit Class').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('class:delete').setLabel('Delete Class').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return {embeds:[embed],components:[row1,row2,row3]};
}

export function publicRaffleEmbed(r:any, loot:any[], entries=0, countdownText?:string, wheelFrame?:string) {
  const endUnix = Math.floor(new Date(r.ends_at).getTime()/1000);
  const ordered = [...loot].sort((a:any,b:any)=>{
    const ac=colorOrder[a.loot_items?.loot_classes?.color]??99;
    const bc=colorOrder[b.loot_items?.loot_classes?.color]??99;
    if(ac!==bc) return ac-bc;
    return String(a.loot_items?.name??'').localeCompare(String(b.loot_items?.name??''));
  });
  const groups = new Map<string,{name:string,color:string,cooldown:number,items:any[]}>();
  for (const x of ordered) {
    const c=x.loot_items?.loot_classes;
    const key=`${c?.color ?? 'none'}:${c?.name ?? 'No class'}`;
    if(!groups.has(key)) groups.set(key,{name:c?.name ?? 'No class',color:c?.color ?? 'none',cooldown:c?.cooldown_hours ?? 0,items:[]});
    groups.get(key)!.items.push(x);
  }
  const lines:string[]=[];
  for(const g of groups.values()){
    lines.push(`${colorEmoji[g.color] ?? '⬜'} **${g.name.toUpperCase()}** · ${g.cooldown}h cooldown`);
    for(const x of g.items) lines.push(`• **${x.loot_items?.name ?? 'Loot'} ×${x.quantity}**`);
    lines.push('');
  }
  const timerLine = countdownText ? `⏳ **Time left: ${countdownText}**` : `⏳ **Entries close <t:${endUnix}:R>**`;
  const wheelLine = wheelFrame ? `\n🎡 **WHEEL SPINNING** ${wheelFrame}` : '';
  return new EmbedBuilder()
    .setTitle(`${wheelFrame ? '🎡' : '🎁'} ${r.title}`)
    .setDescription([r.intro_text || '', '', ...lines, `${timerLine}${wheelLine}`, `👥 ${entries} player(s) entered`, '', r.closing_text || ''].join('\n'));
}

export function playerButtons(raffleId:string, closed=false) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`player:select:${raffleId}`).setLabel('Select Loot').setEmoji('🎁').setStyle(ButtonStyle.Primary).setDisabled(closed),
    new ButtonBuilder().setCustomId(`player:my:${raffleId}`).setLabel('My Selection').setEmoji('✅').setStyle(ButtonStyle.Secondary),
  )];
}

export function lootSelect(customId:string, options:any[], selected:string[] = [], placeholder='Choose all loot you want') {
  const ordered = sortByColor(options);
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(Math.max(1, Math.min(25, ordered.length)))
    .addOptions(ordered.slice(0,25).map(x => ({
      label: x.name.slice(0,100),
      value: x.id,
      description: `${x.loot_classes?.name ?? 'No class'} · ${x.loot_classes?.cooldown_hours ?? 0}h`,
      emoji: colorEmoji[x.loot_classes?.color] ?? '⬜',
      default: selected.includes(x.id),
    })));
}
