import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { cfg } from './config.js';

const commands = [
  new SlashCommandBuilder().setName('raffle').setDescription('Open the Vanguard raffle admin panel'),
  new SlashCommandBuilder().setName('cooldown').setDescription('Show loot cooldowns')
    .addUserOption(o=>o.setName('player').setDescription('Admin: check another player').setRequired(false)),
  new SlashCommandBuilder().setName('cooldown-reset').setDescription('Admin: reset cooldowns for one player or everyone')
    .addUserOption(o=>o.setName('player').setDescription('Player to reset').setRequired(false))
    .addBooleanOption(o=>o.setName('all').setDescription('Reset cooldowns for everyone').setRequired(false)),
  new SlashCommandBuilder().setName('loothistory').setDescription('Show the last 3 raffles'),
  new SlashCommandBuilder().setName('loot-screenshot').setDescription('Detect loot from a screenshot')
    .addAttachmentOption(o => o.setName('image').setDescription('Loot screenshot').setRequired(true)),
].map(c => c.toJSON());

export async function registerCommands(){
  const rest = new REST({version:'10'}).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body: commands });
}
