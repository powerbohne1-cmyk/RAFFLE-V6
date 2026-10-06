export const cfg = {
  token: process.env.DISCORD_TOKEN!,
  clientId: process.env.DISCORD_CLIENT_ID!,
  guildId: process.env.DISCORD_GUILD_ID!,
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID!,
  raffleChannelId: process.env.DISCORD_RAFFLE_CHANNEL_ID!,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  openaiKey: process.env.OPENAI_API_KEY,
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-5.4-mini',
};

export function assertConfig() {
  const required = ['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DISCORD_ADMIN_ROLE_ID','DISCORD_RAFFLE_CHANNEL_ID','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
}
