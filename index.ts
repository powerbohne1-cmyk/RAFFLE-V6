import 'dotenv/config';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder,
  GatewayIntentBits, Interaction, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder
} from 'discord.js';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import { assertConfig, cfg } from './config.js';
import { db, activeClasses, activeLoot } from './db.js';
import { adminHome, colorEmoji, colorOrder, lootSelect, lootSettingsHome, playerButtons, publicRaffleEmbed } from './ui.js';
import { registerCommands } from './register.js';

assertConfig();
const client = new Client({ intents:[GatewayIntentBits.Guilds] });
const timers = new Map<string, NodeJS.Timeout[]>();
const logoPath = fileURLToPath(new URL('../book-of-randy.png', import.meta.url));

function isAdmin(i:any){
  return i.member?.roles?.cache?.has?.(cfg.adminRoleId) || i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);
}
function shuffle<T>(a:T[]){ return [...a].sort(() => Math.random() - 0.5); }
function fmtMi(d:string){
  const x=new Date(d);
  const pad=(n:number)=>String(n).padStart(2,'0');
  return `${pad(x.getDate())}.${pad(x.getMonth()+1)}.${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
function logoFile(){ return new AttachmentBuilder(logoPath,{name:'book-of-randy.png'}); }
function proxyId(name:string){
  const normalized=name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
  return `proxy:${normalized || 'player'}`;
}
function winnerLabel(w:any){
  return String(w.discord_user_id).startsWith('proxy:') ? `👑 **${w.discord_display_name}** *(Proxy)*` : `👑 <@${w.discord_user_id}>`;
}
function sortRaffleLoot(items:any[]){
  return [...items].sort((a,b)=>{
    const ac=colorOrder[a.loot_items?.loot_classes?.color]??99;
    const bc=colorOrder[b.loot_items?.loot_classes?.color]??99;
    if(ac!==bc) return ac-bc;
    return String(a.loot_items?.name??'').localeCompare(String(b.loot_items?.name??''));
  });
}

async function getRaffle(id:string){
  const {data,error} = await db.from('raffles').select('*').eq('id', id).single();
  if(error) throw error;
  return data;
}
async function getRaffleLoot(id:string){
  const {data,error} = await db.from('raffle_loot').select('id,quantity,loot_item_id,loot_items(id,name,emoji,loot_class_id,sort_order,loot_classes(id,name,color,cooldown_hours))').eq('raffle_id',id);
  if(error) throw error;
  return sortRaffleLoot(data ?? []);
}
async function getEntriesCount(id:string){
  const {data,error} = await db.from('raffle_entries').select('discord_user_id').eq('raffle_id',id);
  if(error) throw error;
  return new Set((data??[]).map((x:any)=>x.discord_user_id)).size;
}
async function updatePublic(raffleId:string, countdownText?:string, wheelFrame?:string){
  const r = await getRaffle(raffleId); if(!r?.message_id) return;
  const channel:any = await client.channels.fetch(r.channel_id); if(!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(r.message_id).catch(()=>null); if(!message) return;
  await message.edit({embeds:[publicRaffleEmbed(r, await getRaffleLoot(raffleId), await getEntriesCount(raffleId), countdownText, wheelFrame)], components:playerButtons(raffleId,r.status!=='open')});
}
function formatCountdown(ms:number){
  const total=Math.max(0,Math.ceil(ms/1000));
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const s=total%60;
  const pad=(n:number)=>String(n).padStart(2,'0');
  return h>0?`${pad(h)}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`;
}
const wheelFrames=['◴','◷','◶','◵','◴','◷','◶','◵','◴','◷'];
async function runCountdownTick(raffleId:string){
  const r=await getRaffle(raffleId);
  if(!r || r.status!=='open') return;
  const left=new Date(r.ends_at).getTime()-Date.now();
  if(left<=0) return;
  const seconds=Math.ceil(left/1000);
  const wheelFrame=seconds<=10 ? `${wheelFrames[(10-seconds)%wheelFrames.length]} **${seconds}**` : undefined;
  await updatePublic(raffleId,formatCountdown(left),wheelFrame).catch(()=>{});
  const delay=seconds<=10?1000:seconds<=60?5000:10000;
  const t=setTimeout(()=>runCountdownTick(raffleId),Math.min(delay,left));
  const list=timers.get(raffleId)??[]; list.push(t); timers.set(raffleId,list);
}
async function scheduleRaffle(raffleId:string){
  const r = await getRaffle(raffleId); if(!r || r.status!=='open') return;
  timers.get(raffleId)?.forEach(clearTimeout);
  const ms = new Date(r.ends_at).getTime()-Date.now();
  const list:NodeJS.Timeout[]=[];
  timers.set(raffleId,list);
  void runCountdownTick(raffleId);
  if(ms>60000){
    list.push(setTimeout(async()=>{
      const rr=await getRaffle(raffleId); if(rr?.status!=='open') return;
      const ch:any=await client.channels.fetch(rr.channel_id);
      await ch?.send({
        content:'@everyone ⏰ **LAST MINUTE!** The MI Loot Raffle closes in **1 minute**. Make your final loot selections now.',
        allowedMentions:{parse:['everyone']}
      });
    }, ms-60000));
  }
  if(ms>0){
    list.push(setTimeout(async()=>{
      await db.from('raffles').update({status:'closed'}).eq('id',raffleId).eq('status','open');
      await updatePublic(raffleId);
      const rr=await getRaffle(raffleId); const ch:any=await client.channels.fetch(rr.channel_id);
      const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`admin:spin:${raffleId}`).setLabel('Spin Raffle').setEmoji('🎡').setStyle(ButtonStyle.Success)
      );
      await ch?.send({content:'🔒 **Entries closed.** An admin can now spin once for all loot.',components:[row]});
    },ms));
  }
}

async function openCreateModal(i:any){
  const modal=new ModalBuilder().setCustomId('modal:create').setTitle('Create Raffle');
  const title=new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setValue('Monster Invasion Loot');
  const intro=new TextInputBuilder().setCustomId('intro').setLabel('Start text').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Text shown above the loot');
  const closing=new TextInputBuilder().setCustomId('closing').setLabel('Closing text').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Text shown below the loot');
  const results=new TextInputBuilder().setCustomId('results').setLabel('Results text').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Text shown below the final results');
  const mins=new TextInputBuilder().setCustomId('minutes').setLabel('Entry timer in minutes').setStyle(TextInputStyle.Short).setRequired(true).setValue('30');
  modal.addComponents(...[title,intro,closing,results,mins].map(x=>new ActionRowBuilder<TextInputBuilder>().addComponents(x)));
  await i.showModal(modal);
}

async function showDraftLoot(i:any, raffleId:string){
  const items:any[]=await activeLoot();
  if(!items.length) return i.reply({content:'📦 No saved loot yet. Open `/raffle` → **Loot Settings** → **Add Loot**.',ephemeral:true});
  const {data:selected,error}=await db.from('raffle_loot').select('loot_item_id').eq('raffle_id',raffleId);
  if(error) throw error;
  const selectedIds=(selected??[]).map((x:any)=>x.loot_item_id);
  const menu=lootSelect(`draft:loot:${raffleId}`,items,selectedIds,'Select loot for this raffle');
  const row1=new ActionRowBuilder<any>().addComponents(menu);
  const row2=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`draft:edit:${raffleId}`).setLabel('Edit Loot').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`draft:qty:${raffleId}`).setLabel('Set Quantities').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`draft:start:${raffleId}`).setLabel('Start Raffle').setEmoji('🚀').setStyle(ButtonStyle.Success)
  );
  awawait i.reply({
  content:'📦 **Build your raffle**\nSelect or edit loot at any time before launch, set quantities with `+ / −`, then press **Start Raffle**.',
  components:[row1,row2],
  ephemeral:true
});

async function startRaffle(raffleId:string, i:any){
  const r=await getRaffle(raffleId); const loot=await getRaffleLoot(raffleId);
  if(!loot.length) return i.reply({content:'Add at least one loot item first.',ephemeral:true});
  const channel:any=await client.channels.fetch(cfg.raffleChannelId);
  if(!channel?.isTextBased()) return i.reply({content:'The configured raffle channel is not a text channel.',ephemeral:true});
  const endsAt=new Date(r.ends_at);
  const msg=await channel.send({
    content:'@everyone 🎁 **A new Monster Invasion Loot Raffle has started!** Select your loot before the timer ends.',
    embeds:[publicRaffleEmbed({...r,status:'open'},loot,0)],
    components:playerButtons(raffleId,false),
    allowedMentions:{parse:['everyone']}
  });
  await db.from('raffles').update({status:'open',channel_id:channel.id,message_id:msg.id,starts_at:new Date().toISOString()}).eq('id',raffleId);
  await scheduleRaffle(raffleId);
  await i.reply({content:`✅ Raffle started in <#${channel.id}>. Entries close <t:${Math.floor(endsAt.getTime()/1000)}:R>.`,ephemeral:true});
}

async function spinRaffle(raffleId:string,i:any){
  const r=await getRaffle(raffleId); if(!r || !['closed','open'].includes(r.status)) return i.reply({content:'This raffle cannot be spun.',ephemeral:true});
  const loot:any[]=await getRaffleLoot(raffleId);
  const results:any[]=[];
  const wonClasses=new Map<string,Set<string>>();
  for(const rl of loot){
    const item=rl.loot_items; const cls=item?.loot_classes;
    const {data:entries,error}=await db.from('raffle_entries').select('*').eq('raffle_id',raffleId).eq('loot_item_id',rl.loot_item_id);
    if(error) throw error;
    const eligible:any[]=[];
    const seenForLoot=new Set<string>();
    for(const e of entries??[]){
      // One participant can win this specific loot at most once, even if quantity > 1.
      if(seenForLoot.has(e.discord_user_id)) continue;
      seenForLoot.add(e.discord_user_id);
      if(cls?.id){
        // A cooldown is class-wide: winning any Red/Gold/Purple/Blue loot blocks only that class.
        const {data:cd,error:cdError}=await db.from('player_cooldowns').select('*').eq('discord_user_id',e.discord_user_id).eq('loot_class_id',cls.id).maybeSingle();
        if(cdError) throw cdError;
        if(cd && new Date(cd.cooldown_until).getTime()>Date.now()) continue;
        // During the same spin, one win in a class immediately removes the player from all later loot in that class.
        if(wonClasses.get(e.discord_user_id)?.has(cls.id)) continue;
      }
      eligible.push(e);
    }
    const winners=shuffle(eligible).slice(0,Math.min(rl.quantity,eligible.length));
    for(const w of winners){
      const {data:win,error:winError}=await db.from('raffle_winners').insert({raffle_id:raffleId,loot_item_id:rl.loot_item_id,loot_class_id:cls?.id,discord_user_id:w.discord_user_id,discord_display_name:w.discord_display_name}).select().single();
      if(winError) throw winError;
      if(cls?.id){
        const set=wonClasses.get(w.discord_user_id)??new Set<string>(); set.add(cls.id); wonClasses.set(w.discord_user_id,set);
        if((cls.cooldown_hours??0)>0){
          const until=new Date(Date.now()+cls.cooldown_hours*3600_000).toISOString();
          const {error:upsertError}=await db.from('player_cooldowns').upsert({discord_user_id:w.discord_user_id,loot_class_id:cls.id,cooldown_until:until,source_winner_id:win?.id});
          if(upsertError) throw upsertError;
        }
      }
    }
    results.push({item,quantity:rl.quantity,winners});
  }
  await db.from('raffles').update({status:'spun'}).eq('id',raffleId);
  const lines=results.flatMap(x=>{
    const cls=x.item?.loot_classes; const em=colorEmoji[cls?.color]??'⬜';
    const wins=x.winners.length?x.winners.map(winnerLabel).join('\n'):'No eligible winner';
    const unawarded=Math.max(0,Number(x.quantity)-x.winners.length);
    return [`${em} **${x.item.name} ×${x.quantity}**`,wins,unawarded?`_${unawarded} unawarded — no additional eligible unique participant._`:'',''];
  });
  const resultDescription=[lines.join('\n'), r.result_text ? `\n${r.result_text}` : ''].filter(Boolean).join('\n');
  const embed=new EmbedBuilder().setTitle('🏆 Raffle Results').setDescription(resultDescription);
  const ch:any=await client.channels.fetch(r.channel_id);
  await ch?.send({content:'@everyone 🏆 **The raffle results are here!**',embeds:[embed],allowedMentions:{parse:['everyone']}});
  await i.reply({content:`✅ Result saved as **MI ${fmtMi(r.starts_at)}**.`,ephemeral:true});
}

async function showLootList(i:any){
  const items:any[]=await activeLoot();
  const lines=items.map((x:any)=>`${colorEmoji[x.loot_classes?.color]??'⬜'} **${x.name}** · ${x.loot_classes?.name??'No class'} · ${x.loot_classes?.cooldown_hours??0}h`);
  return i.reply({embeds:[new EmbedBuilder().setTitle('🎁 Loot Items').setDescription(lines.join('\n')||'No saved loot yet.')],ephemeral:true});
}
async function showClassList(i:any){
  const data:any[]=await activeClasses();
  const lines=data.map((x:any)=>`${colorEmoji[x.color]??'⬜'} **${x.name}** · ${x.cooldown_hours}h cooldown`);
  return i.reply({embeds:[new EmbedBuilder().setTitle('🎨 Loot Classes').setDescription(lines.join('\n')||'No loot classes yet.')],ephemeral:true});
}

function colorMenu(customId:string){
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Choose a color').setMinValues(1).setMaxValues(1).addOptions([
    {label:'Red',value:'red',emoji:'🟥'}, {label:'Gold',value:'gold',emoji:'🟨'}, {label:'Purple',value:'purple',emoji:'🟪'}, {label:'Blue',value:'blue',emoji:'🟦'}
  ]);
}

async function showCooldowns(i:any, userId:string){
  const {data,error}=await db.from('player_cooldowns').select('cooldown_until,loot_classes(name,color)').eq('discord_user_id',userId);
  if(error) throw error;
  const active=(data??[]).filter((x:any)=>new Date(x.cooldown_until).getTime()>Date.now())
    .sort((a:any,b:any)=>(colorOrder[a.loot_classes?.color]??99)-(colorOrder[b.loot_classes?.color]??99));
  const desc=active.length?active.map((x:any)=>`${colorEmoji[x.loot_classes?.color]??'⬜'} **${x.loot_classes?.name}** — <t:${Math.floor(new Date(x.cooldown_until).getTime()/1000)}:R>`).join('\n'):'✅ No active cooldowns.';
  return i.reply({embeds:[new EmbedBuilder().setTitle('⏱️ Loot Cooldowns').setDescription(desc)],ephemeral:true});
}

async function resetCooldownsFor(userId:string){
  const {error}=await db.from('player_cooldowns').delete().eq('discord_user_id',userId);
  if(error) throw error;
}
async function resetAllCooldowns(){
  const {error}=await db.from('player_cooldowns').delete().neq('discord_user_id','');
  if(error) throw error;
}

async function deleteLootItem(i:any,id:string){
  const {data:item,error:itemError}=await db.from('loot_items').select('id,name').eq('id',id).single();
  if(itemError) throw itemError;
  const [{count:raffleRefs,error:e1},{count:winnerRefs,error:e2}] = await Promise.all([
    db.from('raffle_loot').select('*',{count:'exact',head:true}).eq('loot_item_id',id),
    db.from('raffle_winners').select('*',{count:'exact',head:true}).eq('loot_item_id',id),
  ]);
  if(e1) throw e1; if(e2) throw e2;
  if((raffleRefs??0)>0 || (winnerRefs??0)>0){
    const {error}=await db.from('loot_items').update({active:false}).eq('id',id);
    if(error) throw error;
    return i.reply({content:`🗑️ **${item.name}** was removed from the active loot catalog. Historical raffle data was kept.`,ephemeral:true});
  }
  const {error}=await db.from('loot_items').delete().eq('id',id);
  if(error) throw error;
  return i.reply({content:`🗑️ **${item.name}** was permanently deleted.`,ephemeral:true});
}

async function deleteLootClass(i:any,id:string){
  const {data:cls,error:clsError}=await db.from('loot_classes').select('id,name').eq('id',id).single();
  if(clsError) throw clsError;
  const [{count:lootRefs,error:e1},{count:winnerRefs,error:e2}] = await Promise.all([
    db.from('loot_items').select('*',{count:'exact',head:true}).eq('loot_class_id',id),
    db.from('raffle_winners').select('*',{count:'exact',head:true}).eq('loot_class_id',id),
  ]);
  if(e1) throw e1; if(e2) throw e2;
  if((lootRefs??0)>0 || (winnerRefs??0)>0){
    await db.from('loot_classes').update({active:false}).eq('id',id);
    await db.from('loot_items').update({active:false}).eq('loot_class_id',id);
    return i.reply({content:`🗑️ **${cls.name}** and its loot were removed from active menus. Historical raffle data was kept.`,ephemeral:true});
  }
  await db.from('player_cooldowns').delete().eq('loot_class_id',id);
  const {error}=await db.from('loot_classes').delete().eq('id',id);
  if(error) throw error;
  return i.reply({content:`🗑️ **${cls.name}** was permanently deleted.`,ephemeral:true});
}

client.on('interactionCreate',async(i:Interaction)=>{
  try{
    if(i.isChatInputCommand()){
      if(i.commandName==='raffle'){
        if(!isAdmin(i)) return i.reply({content:'Admin role required.',ephemeral:true});
        return i.reply({...adminHome(),files:[logoFile()],ephemeral:true});
      }
      if(i.commandName==='cooldown'){
        const target=i.options.getUser('player');
        if(target && !isAdmin(i)) return i.reply({content:'Only admins can check another player.',ephemeral:true});
        return showCooldowns(i,target?.id??i.user.id);
      }
      if(i.commandName==='cooldown-reset'){
        if(!isAdmin(i)) return i.reply({content:'Admin role required.',ephemeral:true});
        const all=i.options.getBoolean('all')??false;
        const target=i.options.getUser('player');
        if(all){ await resetAllCooldowns(); return i.reply({content:'✅ All player cooldowns have been reset.',ephemeral:true}); }
        if(!target) return i.reply({content:'Choose a player or set `all` to true.',ephemeral:true});
        await resetCooldownsFor(target.id);
        return i.reply({content:`✅ Cooldowns reset for <@${target.id}>.`,ephemeral:true});
      }
      if(i.commandName==='loothistory'){
        const {data:rs,error}=await db.from('raffles').select('id,title,starts_at').eq('status','spun').order('starts_at',{ascending:false}).limit(3);
        if(error) throw error;
        const parts:string[]=[];
        for(const r of rs??[]){
          const {data:w,error:wError}=await db.from('raffle_winners').select('discord_user_id,discord_display_name,loot_items(name,loot_classes(color))').eq('raffle_id',r.id);
          if(wError) throw wError;
          const ordered=[...(w??[])].sort((a:any,b:any)=>(colorOrder[a.loot_items?.loot_classes?.color]??99)-(colorOrder[b.loot_items?.loot_classes?.color]??99) || String(a.loot_items?.name??'').localeCompare(String(b.loot_items?.name??'')));
          parts.push(`**MI ${fmtMi(r.starts_at)}**\n${ordered.map((x:any)=>`${colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'} ${x.loot_items?.name} — ${x.discord_display_name}${String(x.discord_user_id).startsWith('proxy:')?' (Proxy)':''}`).join('\n')||'No winners'}`);
        }
        return i.reply({embeds:[new EmbedBuilder().setTitle('📜 Last 3 Raffles').setDescription(parts.join('\n\n')||'No raffles yet.')],ephemeral:true});
      }
      if(i.commandName==='loot-screenshot'){
        if(!isAdmin(i)) return i.reply({content:'Admin role required.',ephemeral:true});
        const image=i.options.getAttachment('image',true);
        if(!cfg.openaiKey) return i.reply({content:'📸 Screenshot received. Set `OPENAI_API_KEY` to enable automatic loot detection.',ephemeral:true});
        await i.deferReply({ephemeral:true});
        const catalog:any[]=await activeLoot();
        const ai=new OpenAI({apiKey:cfg.openaiKey});
        const response=await ai.responses.create({
          model:cfg.visionModel,
          input:[{role:'user',content:[
            {type:'input_text',text:`Read this game loot screenshot. Match visible loot to this saved catalog: ${catalog.map(x=>x.name).join(', ')}. Return JSON array only, no markdown: [{"name":"...","quantity":1}]`},
            {type:'input_image',image_url:image.url,detail:'high'}
          ]}]
        } as any);
        let parsed:any[]=[];
        try{ parsed=JSON.parse(response.output_text.trim()); }catch{}
        if(!Array.isArray(parsed)) parsed=[];
        const matched=parsed.map((p:any)=>{
          const found=catalog.find(x=>x.name.toLowerCase()===String(p.name??'').toLowerCase());
          return found?{...found,quantity:Math.max(1,Number(p.quantity)||1)}:{name:String(p.name??'Unknown'),quantity:Math.max(1,Number(p.quantity)||1),unknown:true};
        });
        const ordered=[...matched].sort((a:any,b:any)=>(colorOrder[a.loot_classes?.color]??99)-(colorOrder[b.loot_classes?.color]??99));
        const lines=ordered.map((x:any)=>`${x.unknown?'❓':(colorEmoji[x.loot_classes?.color]??'⬜')} **${x.name}** ×${x.quantity}${x.unknown?' · NEW':''}`);
        return i.editReply(`📸 **Detected Loot**\n\n${lines.join('\n')||'No loot was detected with confidence.'}\n\nUse saved loot through \`/raffle\` → **Create Raffle**. Save unknown items first under **Loot Settings → Add Loot**.`);
      }
    }

    if(i.isButton()){
      if(i.customId==='admin:create'){ if(!isAdmin(i)) return; return openCreateModal(i); }
      if(i.customId==='admin:history'){ return i.reply({content:'📜 Use `/loothistory` to show the last 3 raffles.',ephemeral:true}); }
      if(i.customId==='admin:cooldowns'){
        if(!isAdmin(i)) return;
        const users=new UserSelectMenuBuilder().setCustomId('cooldown:reset:user').setPlaceholder('Reset cooldowns for one player').setMinValues(1).setMaxValues(1);
        const row1=new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(users);
        const row2=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('cooldown:reset:all').setLabel('Reset All Cooldowns').setEmoji('♻️').setStyle(ButtonStyle.Danger));
        return i.reply({content:'⏱️ Select one player to reset, or reset cooldowns for everyone.',components:[row1,row2],ephemeral:true});
      }
      if(i.customId==='cooldown:reset:all'){
        if(!isAdmin(i)) return;
        await resetAllCooldowns();
        return i.reply({content:'✅ All player cooldowns have been reset.',ephemeral:true});
      }
      if(i.customId==='admin:loot'){ if(!isAdmin(i)) return; return i.reply({...lootSettingsHome(),ephemeral:true}); }
      if(i.customId==='admin:active'){
        const {data:r,error}=await db.from('raffles').select('*').in('status',['open','closed']).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(error) throw error;
        if(!r) return i.reply({content:'No active raffle.',ephemeral:true});
        const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`active:view:${r.id}`).setLabel('View Entries').setEmoji('👥').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`active:proxy:${r.id}`).setLabel('Add Proxy').setEmoji('👤').setStyle(ButtonStyle.Primary).setDisabled(r.status!=='open'),
          new ButtonBuilder().setCustomId(`active:close:${r.id}`).setLabel('Close Now').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(r.status!=='open'),
          new ButtonBuilder().setCustomId(`admin:spin:${r.id}`).setLabel('Spin').setEmoji('🎡').setStyle(ButtonStyle.Success).setDisabled(r.status==='open')
        );
        return i.reply({content:`🎯 **${r.title}** · ${r.status.toUpperCase()} · ends <t:${Math.floor(new Date(r.ends_at).getTime()/1000)}:R>`,components:[row],ephemeral:true});
      }
      if(i.customId==='loot:list') return showLootList(i);
      if(i.customId==='class:list') return showClassList(i);
      if(i.customId==='class:add'){
        const row=new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(colorMenu('class:add:color'));
        return i.reply({content:'🎨 Choose the color for the new loot class.',components:[row],ephemeral:true});
      }
      if(i.customId==='class:edit'){
        const data:any[]=await activeClasses();
        if(!data.length) return i.reply({content:'No loot classes exist yet.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId('class:edit:select').setPlaceholder('Choose a loot class').addOptions(data.slice(0,25).map((x:any)=>({label:x.name,value:x.id,description:`${x.cooldown_hours}h · ${x.color}`,emoji:colorEmoji[x.color]??'⬜'})));
        return i.reply({content:'✏️ Which loot class do you want to edit?',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      }
      if(i.customId==='class:delete'){
        const data:any[]=await activeClasses();
        if(!data.length) return i.reply({content:'No loot classes to delete.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId('class:delete:select').setPlaceholder('Delete a loot class').addOptions(data.slice(0,25).map((x:any)=>({label:x.name,value:x.id,description:`${x.cooldown_hours}h · ${x.color}`,emoji:colorEmoji[x.color]??'⬜'})));
        return i.reply({content:'🗑️ Select the loot class you want to remove.',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      }
      if(i.customId==='loot:add'){
        const data:any[]=await activeClasses();
        if(!data.length) return i.reply({content:'Create a loot class first.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId('loot:add:class').setPlaceholder('Choose a loot class').addOptions(data.slice(0,25).map((x:any)=>({label:x.name,value:x.id,description:`${x.cooldown_hours}h`,emoji:colorEmoji[x.color]??'⬜'})));
        return i.reply({content:'🎁 Choose the loot class for the new item.',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      }
      if(i.customId==='loot:delete'){
        const items:any[]=await activeLoot();
        if(!items.length) return i.reply({content:'No active loot to delete.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId('loot:delete:select').setPlaceholder('Delete loot').setMinValues(1).setMaxValues(1).addOptions(items.slice(0,25).map((x:any)=>({label:x.name,value:x.id,emoji:colorEmoji[x.loot_classes?.color]??'⬜'})));
        return i.reply({content:'🗑️ Select the loot item you want to remove.',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      }
      if(i.customId.startsWith('active:view:')){
        const id=i.customId.split(':')[2];
        const {data,error}=await db.from('raffle_entries').select('discord_user_id,discord_display_name,loot_items(name,loot_classes(color))').eq('raffle_id',id).order('discord_display_name');
        if(error) throw error;
        const ordered=[...(data??[])].sort((a:any,b:any)=>(colorOrder[a.loot_items?.loot_classes?.color]??99)-(colorOrder[b.loot_items?.loot_classes?.color]??99) || String(a.loot_items?.name??'').localeCompare(String(b.loot_items?.name??'')));
        const lines=ordered.map((x:any)=>`${colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'} **${x.discord_display_name}${String(x.discord_user_id).startsWith('proxy:')?' (Proxy)':''}** → ${x.loot_items?.name}`);
        return i.reply({content:lines.join('\n').slice(0,1900)||'No entries yet.',ephemeral:true});
      }
      if(i.customId.startsWith('active:proxy:')){
        if(!isAdmin(i)) return;
        const raffleId=i.customId.split(':')[2];
        const raffle=await getRaffle(raffleId);
        if(raffle.status!=='open') return i.reply({content:'Proxy entries can only be added while the raffle is open.',ephemeral:true});
        const loot=await getRaffleLoot(raffleId);
        if(!loot.length) return i.reply({content:'This raffle has no loot.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId(`proxy:loot:${raffleId}`).setPlaceholder('Choose loot for the proxy').setMinValues(1).setMaxValues(1).addOptions(loot.slice(0,25).map((x:any)=>({label:x.loot_items?.name??'Loot',value:x.loot_item_id,description:`${x.loot_items?.loot_classes?.name??'No class'} · ${x.loot_items?.loot_classes?.cooldown_hours??0}h`,emoji:colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'})));
        return i.reply({content:'👤 Choose the loot this proxy player wants to enter for.',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      }
      if(i.customId.startsWith('proxy:user:')){
        if(!isAdmin(i)) return;
        const [, , raffleId, lootId]=i.customId.split(':');
        const raffle=await getRaffle(raffleId);
        if(raffle.status!=='open') return i.reply({content:'This raffle is already closed.',ephemeral:true});
        const users=new UserSelectMenuBuilder().setCustomId(`proxy:userselect:${raffleId}:${lootId}`).setPlaceholder('Select the real Discord player').setMinValues(1).setMaxValues(1);
        return i.reply({content:'👤 Select the Discord player you want to enter as a proxy.',components:[new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(users)],ephemeral:true});
      }
      if(i.customId.startsWith('proxy:name:')){
        if(!isAdmin(i)) return;
        const [, , raffleId, lootId]=i.customId.split(':');
        const raffle=await getRaffle(raffleId);
        if(raffle.status!=='open') return i.reply({content:'This raffle is already closed.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`proxy:add:${raffleId}:${lootId}`).setTitle('Add Proxy by Name');
        const name=new TextInputBuilder().setCustomId('proxy_name').setLabel('Proxy player name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Player name');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name));
        return i.showModal(modal);
      }
      if(i.customId.startsWith('active:close:')){
        const id=i.customId.split(':')[2];
        await db.from('raffles').update({status:'closed',ends_at:new Date().toISOString()}).eq('id',id).eq('status','open');
        timers.get(id)?.forEach(clearTimeout); await updatePublic(id);
        const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`admin:spin:${id}`).setLabel('Spin Raffle').setEmoji('🎡').setStyle(ButtonStyle.Success));
        return i.reply({content:'🔒 Raffle closed.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('draft:edit:')){
        const raffleId=i.customId.split(':')[2];
        const r=await getRaffle(raffleId);
        if(!r || r.status!=='draft') return i.reply({content:'This raffle has already been started or closed.',ephemeral:true});
        return showDraftLoot(i,raffleId);
      }
      if(i.customId.startsWith('draft:start:')) return startRaffle(i.customId.split(':')[2],i);
      if(i.customId.startsWith('admin:spin:')){ if(!isAdmin(i)) return; return spinRaffle(i.customId.split(':')[2],i); }
      if(i.customId.startsWith('player:select:')){
        const raffleId=i.customId.split(':')[2]; const r=await getRaffle(raffleId);
        if(!r||r.status!=='open') return i.reply({content:'This raffle is closed.',ephemeral:true});
        const rl:any[]=await getRaffleLoot(raffleId); const ids=rl.map(x=>x.loot_item_id);
        const items:any[]=await activeLoot();
        const {data:cds,error:cdError}=await db.from('player_cooldowns').select('loot_class_id,cooldown_until').eq('discord_user_id',i.user.id);
        if(cdError) throw cdError;
        const blocked=new Set((cds??[]).filter((x:any)=>new Date(x.cooldown_until).getTime()>Date.now()).map((x:any)=>x.loot_class_id));
        const allowed=items.filter(x=>ids.includes(x.id) && !blocked.has(x.loot_classes?.id));
        if(!allowed.length) return i.reply({content:'🔒 You currently have no eligible loot in this raffle because of active cooldowns.',ephemeral:true});
        const {data:mine,error:mineError}=await db.from('raffle_entries').select('loot_item_id').eq('raffle_id',raffleId).eq('discord_user_id',i.user.id);
        if(mineError) throw mineError;
        const row=new ActionRowBuilder<any>().addComponents(lootSelect(`player:choose:${raffleId}`,allowed,(mine??[]).map((x:any)=>x.loot_item_id),'Choose the loot you want'));
        return i.reply({content:'🎁 Choose every loot item you want to win. Loot blocked by an active class cooldown is hidden.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('player:my:')){
        const id=i.customId.split(':')[2]; const {data,error}=await db.from('raffle_entries').select('loot_items(name,loot_classes(color))').eq('raffle_id',id).eq('discord_user_id',i.user.id);
        if(error) throw error;
        const ordered=[...(data??[])].sort((a:any,b:any)=>(colorOrder[a.loot_items?.loot_classes?.color]??99)-(colorOrder[b.loot_items?.loot_classes?.color]??99));
        return i.reply({content:ordered.length?ordered.map((x:any)=>`${colorEmoji[x.loot_items?.loot_classes?.color]??'⬜'} ${x.loot_items?.name}`).join('\n'):'No loot selected yet.',ephemeral:true});
      }
      if(i.customId.startsWith('draft:qty:')){
        const id=i.customId.split(':')[2]; const rl:any[]=await getRaffleLoot(id);
        const rows=rl.slice(0,5).map(x=>new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`qty:minus:${x.id}:${id}`).setLabel('−').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('noop').setLabel(`${x.loot_items?.name}: ${x.quantity}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(`qty:plus:${x.id}:${id}`).setLabel('+').setStyle(ButtonStyle.Secondary)
        ));
        const note=rl.length>5?'Showing the first 5 selected loot items.':'Set the quantity for each selected loot item.';
        return i.reply({content:`➕ **Set Quantities**\n${note}`,components:rows,ephemeral:true});
      }
      if(i.customId.startsWith('qty:')){
        const [_,dir,rowId,raffleId]=i.customId.split(':'); const {data:row,error}=await db.from('raffle_loot').select('quantity,loot_items(name)').eq('id',rowId).single();
        if(error) throw error;
        const next=Math.max(1,Math.min(99,(row?.quantity??1)+(dir==='plus'?1:-1)));
        const {error:updateError}=await db.from('raffle_loot').update({quantity:next}).eq('id',rowId);
        if(updateError) throw updateError;
        const nav=new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`draft:edit:${raffleId}`).setLabel('Edit Loot').setEmoji('✏️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`draft:qty:${raffleId}`).setLabel('Set More Quantities').setEmoji('➕').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`draft:start:${raffleId}`).setLabel('Start Raffle').setEmoji('🚀').setStyle(ButtonStyle.Success)
        );
        return i.update({content:`✅ **${(row as any)?.loot_items?.name??'Loot'}** quantity changed to **${next}**.`,components:[nav]});
      }
    }

    if(i.isUserSelectMenu()){
      if(i.customId==='cooldown:reset:user'){
        if(!isAdmin(i)) return;
        const userId=i.values[0];
        await resetCooldownsFor(userId);
        return i.reply({content:`✅ Cooldowns reset for <@${userId}>.`,ephemeral:true});
      }
      if(i.customId.startsWith('proxy:userselect:')){
        if(!isAdmin(i)) return;
        const [, , raffleId, lootId]=i.customId.split(':');
        const raffle=await getRaffle(raffleId);
        if(raffle.status!=='open') return i.reply({content:'This raffle is already closed.',ephemeral:true});
        const userId=i.values[0];
        const selectedUser=i.users.get(userId);
        if(!selectedUser) return i.reply({content:'Could not resolve that Discord user.',ephemeral:true});
        const member=await i.guild?.members.fetch(userId).catch(()=>null);
        const displayName=member?.displayName ?? selectedUser.globalName ?? selectedUser.username;
        const {data:lootRow,error:lootError}=await db.from('loot_items').select('name,loot_class_id,loot_classes(name,color,cooldown_hours)').eq('id',lootId).single();
        if(lootError) throw lootError;
        if(lootRow.loot_class_id){
          const {data:cd,error:cdError}=await db.from('player_cooldowns').select('cooldown_until').eq('discord_user_id',userId).eq('loot_class_id',lootRow.loot_class_id).maybeSingle();
          if(cdError) throw cdError;
          if(cd && new Date(cd.cooldown_until).getTime()>Date.now()) return i.reply({content:`🔒 <@${userId}> is still on cooldown for this loot class until <t:${Math.floor(new Date(cd.cooldown_until).getTime()/1000)}:R>.`,allowedMentions:{users:[]},ephemeral:true});
        }
        const {error}=await db.from('raffle_entries').upsert({raffle_id:raffleId,loot_item_id:lootId,discord_user_id:userId,discord_display_name:displayName},{onConflict:'raffle_id,loot_item_id,discord_user_id'});
        if(error) throw error;
        await updatePublic(raffleId);
        return i.reply({content:`✅ <@${userId}> added as a proxy to ${colorEmoji[(lootRow.loot_classes as any)?.color]??'⬜'} **${lootRow.name}**. Any win and cooldown will be linked to the real Discord account.`,allowedMentions:{users:[]},ephemeral:true});
      }
    }

    if(i.isModalSubmit()){
      if(i.customId==='modal:create'){
        const title=i.fields.getTextInputValue('title');
        const intro=i.fields.getTextInputValue('intro');
        const closing=i.fields.getTextInputValue('closing');
        const results=i.fields.getTextInputValue('results');
        const mins=Math.max(1,Math.min(10080,Number(i.fields.getTextInputValue('minutes'))||30));
        const {data:r,error}=await db.from('raffles').insert({guild_id:cfg.guildId,channel_id:cfg.raffleChannelId,created_by:i.user.id,title,intro_text:intro,closing_text:closing,result_text:results,ends_at:new Date(Date.now()+mins*60000).toISOString(),status:'draft'}).select().single();
        if(error) throw error;
        return showDraftLoot(i,r.id);
      }
      if(i.customId.startsWith('class:addmodal:')){
        const color=i.customId.split(':')[2];
        const name=i.fields.getTextInputValue('name').trim();
        const cooldown=Math.max(0,Math.min(8760,Number(i.fields.getTextInputValue('cooldown'))||0));
        const {error}=await db.from('loot_classes').insert({name,color,cooldown_hours:cooldown,active:true,sort_order:colorOrder[color]??99});
        if(error) throw error;
        return i.reply({content:`✅ ${colorEmoji[color]??'⬜'} **${name}** saved · ${cooldown}h cooldown.`,ephemeral:true});
      }
      if(i.customId.startsWith('class:editmodal:')){
        const id=i.customId.split(':')[2];
        const name=i.fields.getTextInputValue('name').trim();
        const cooldown=Math.max(0,Math.min(8760,Number(i.fields.getTextInputValue('cooldown'))||0));
        const {error}=await db.from('loot_classes').update({name,cooldown_hours:cooldown}).eq('id',id);
        if(error) throw error;
        return i.reply({content:`✅ Loot class **${name}** updated · ${cooldown}h.`,ephemeral:true});
      }
      if(i.customId.startsWith('loot:addmodal:')){
        const classId=i.customId.split(':')[2];
        const name=i.fields.getTextInputValue('name').trim();
        const emoji=i.fields.getTextInputValue('emoji').trim();
        const imageUrl=i.fields.getTextInputValue('image').trim();
        const {error}=await db.from('loot_items').insert({name,loot_class_id:classId,emoji:emoji||null,image_url:imageUrl||null,active:true});
        if(error) throw error;
        return i.reply({content:`✅ Loot **${name}** saved. It is now available in new raffles.`,ephemeral:true});
      }
      if(i.customId.startsWith('proxy:add:')){
        if(!isAdmin(i)) return;
        const [, , raffleId, lootId]=i.customId.split(':');
        const name=i.fields.getTextInputValue('proxy_name').trim();
        if(!name) return i.reply({content:'Enter a proxy name.',ephemeral:true});
        const raffle=await getRaffle(raffleId);
        if(raffle.status!=='open') return i.reply({content:'This raffle is already closed.',ephemeral:true});
        const pid=proxyId(name);
        const {data:lootRow,error:lootError}=await db.from('loot_items').select('name,loot_class_id,loot_classes(name,color,cooldown_hours)').eq('id',lootId).single();
        if(lootError) throw lootError;
        if(lootRow.loot_class_id){
          const {data:cd,error:cdError}=await db.from('player_cooldowns').select('cooldown_until').eq('discord_user_id',pid).eq('loot_class_id',lootRow.loot_class_id).maybeSingle();
          if(cdError) throw cdError;
          if(cd && new Date(cd.cooldown_until).getTime()>Date.now()) return i.reply({content:`🔒 Proxy **${name}** is still on cooldown for this loot class until <t:${Math.floor(new Date(cd.cooldown_until).getTime()/1000)}:R>.`,ephemeral:true});
        }
        const {error}=await db.from('raffle_entries').upsert({raffle_id:raffleId,loot_item_id:lootId,discord_user_id:pid,discord_display_name:name},{onConflict:'raffle_id,loot_item_id,discord_user_id'});
        if(error) throw error;
        await updatePublic(raffleId);
        return i.reply({content:`✅ Proxy **${name}** added to ${colorEmoji[(lootRow.loot_classes as any)?.color]??'⬜'} **${lootRow.name}**.`,ephemeral:true});
      }
    }

    if(i.isStringSelectMenu()){
      if(i.customId==='class:add:color'){
        const color=i.values[0];
        const modal=new ModalBuilder().setCustomId(`class:addmodal:${color}`).setTitle('Add Loot Class');
        const name=new TextInputBuilder().setCustomId('name').setLabel('Class name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. Legendary');
        const cooldown=new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown in hours').setStyle(TextInputStyle.Short).setRequired(true).setValue('0');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name),new ActionRowBuilder<TextInputBuilder>().addComponents(cooldown));
        return i.showModal(modal);
      }
      if(i.customId==='class:edit:select'){
        const id=i.values[0]; const {data:x,error}=await db.from('loot_classes').select('*').eq('id',id).single();
        if(error) throw error;
        const modal=new ModalBuilder().setCustomId(`class:editmodal:${id}`).setTitle('Edit Loot Class');
        const name=new TextInputBuilder().setCustomId('name').setLabel('Class name').setStyle(TextInputStyle.Short).setRequired(true).setValue(x.name);
        const cooldown=new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown in hours').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(x.cooldown_hours));
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name),new ActionRowBuilder<TextInputBuilder>().addComponents(cooldown));
        return i.showModal(modal);
      }
      if(i.customId==='class:delete:select') return deleteLootClass(i,i.values[0]);
      if(i.customId==='loot:add:class'){
        const classId=i.values[0];
        const modal=new ModalBuilder().setCustomId(`loot:addmodal:${classId}`).setTitle('Add Loot');
        const name=new TextInputBuilder().setCustomId('name').setLabel('Loot name').setStyle(TextInputStyle.Short).setRequired(true);
        const emoji=new TextInputBuilder().setCustomId('emoji').setLabel('Emoji optional').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('🔥');
        const image=new TextInputBuilder().setCustomId('image').setLabel('Image URL optional').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://...');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name),new ActionRowBuilder<TextInputBuilder>().addComponents(emoji),new ActionRowBuilder<TextInputBuilder>().addComponents(image));
        return i.showModal(modal);
      }
      if(i.customId==='loot:delete:select') return deleteLootItem(i,i.values[0]);
      if(i.customId.startsWith('proxy:loot:')){
        const raffleId=i.customId.split(':')[2]; const lootId=i.values[0];
        const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`proxy:user:${raffleId}:${lootId}`).setLabel('Select @User').setEmoji('👤').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`proxy:name:${raffleId}:${lootId}`).setLabel('Enter Name').setEmoji('✍️').setStyle(ButtonStyle.Secondary)
        );
        return i.reply({content:'👤 **How do you want to add this proxy?**\n\n• **Select @User** — links the proxy to the real Discord account, so wins and cooldowns apply to that account.\n• **Enter Name** — keeps a manual proxy name for players you cannot mention.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('draft:loot:')){
        const raffleId=i.customId.split(':')[2];
        const raffle=await getRaffle(raffleId);
        if(!raffle || raffle.status!=='draft') return i.reply({content:'This raffle has already been started or closed.',ephemeral:true});
        const {data:current,error:currentError}=await db.from('raffle_loot').select('loot_item_id,quantity').eq('raffle_id',raffleId);
        if(currentError) throw currentError;
        const wanted=new Set(i.values);
        const existing=new Set((current??[]).map((x:any)=>x.loot_item_id));
        const remove=(current??[]).filter((x:any)=>!wanted.has(x.loot_item_id)).map((x:any)=>x.loot_item_id);
        const add=i.values.filter(id=>!existing.has(id));
        if(remove.length){
          const {error}=await db.from('raffle_loot').delete().eq('raffle_id',raffleId).in('loot_item_id',remove);
          if(error) throw error;
        }
        if(add.length){
          const {error}=await db.from('raffle_loot').insert(add.map(id=>({raffle_id:raffleId,loot_item_id:id,quantity:1})));
          if(error) throw error;
        }
        const nav=new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`draft:edit:${raffleId}`).setLabel('Edit Loot Again').setEmoji('✏️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`draft:qty:${raffleId}`).setLabel('Set Quantities').setEmoji('➕').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`draft:start:${raffleId}`).setLabel('Start Raffle').setEmoji('🚀').setStyle(ButtonStyle.Success)
        );
        return i.reply({content:`✅ ${i.values.length} loot item(s) selected. Existing quantities were kept for loot that stayed selected.`,components:[nav],ephemeral:true});
      }
      if(i.customId.startsWith('player:choose:')){
        const raffleId=i.customId.split(':')[2]; const r=await getRaffle(raffleId);
        if(!r||r.status!=='open') return i.reply({content:'Raffle is closed.',ephemeral:true});
        const {error:delError}=await db.from('raffle_entries').delete().eq('raffle_id',raffleId).eq('discord_user_id',i.user.id);
        if(delError) throw delError;
        const display=(i.member as any)?.displayName ?? i.user.globalName ?? i.user.username;
        if(i.values.length){ const {error}=await db.from('raffle_entries').insert(i.values.map(id=>({raffle_id:raffleId,loot_item_id:id,discord_user_id:i.user.id,discord_display_name:display}))); if(error) throw error; }
        await updatePublic(raffleId);
        return i.reply({content:`✅ Selection saved: ${i.values.length} loot item(s).`,ephemeral:true});
      }
    }
  } catch(e:any){
    console.error(e);
    if(i.isRepliable()){
      const payload={content:`Error: ${e?.message??'Unknown error'}`,ephemeral:true};
      if(i.replied||i.deferred) await i.followUp(payload).catch(()=>{}); else await i.reply(payload).catch(()=>{});
    }
  }
});

client.once('ready',async()=>{
  console.log(`Logged in as ${client.user?.tag}`);
  const {data,error}=await db.from('raffles').select('id').eq('status','open').gt('ends_at',new Date().toISOString());
  if(error) console.error(error);
  for(const r of data??[]) scheduleRaffle(r.id);
});

await registerCommands();
await client.login(cfg.token);
