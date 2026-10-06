
    
  
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

