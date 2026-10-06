import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';

export const db = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { persistSession: false } });
const colorOrder: Record<string,number> = { red:0, gold:1, purple:2, blue:3 };

function sortColor(items:any[]){
  return [...items].sort((a,b)=>{
    const ac=colorOrder[a.loot_classes?.color]??99;
    const bc=colorOrder[b.loot_classes?.color]??99;
    if(ac!==bc) return ac-bc;
    return Number(a.sort_order??0)-Number(b.sort_order??0) || String(a.name??'').localeCompare(String(b.name??''));
  });
}

export async function activeLoot() {
  const { data, error } = await db.from('loot_items').select('id,name,emoji,sort_order,loot_classes(id,name,color,cooldown_hours)').eq('active', true);
  if (error) throw error;
  return sortColor(data ?? []);
}

export async function activeClasses() {
  const { data, error } = await db.from('loot_classes').select('*').eq('active', true);
  if (error) throw error;
  return [...(data ?? [])].sort((a:any,b:any)=>(colorOrder[a.color]??99)-(colorOrder[b.color]??99) || Number(a.sort_order??0)-Number(b.sort_order??0) || a.name.localeCompare(b.name));
}
