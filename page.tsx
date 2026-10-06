import { supabase } from '../../lib/supabase';

const C:any={gold:'#d4af37',purple:'#9b51e0',blue:'#2f80ed',red:'#eb5757'};
function fmt(d:string){return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(d)).replace(',','');}

export const revalidate=0;
export default async function Page(){
  const {data:raffles}=await supabase.from('raffles').select('id,starts_at').eq('status','spun').order('starts_at',{ascending:false}).limit(100);
  const cards:any[]=[];
  for(const r of raffles??[]){
    const {data:winners}=await supabase.from('raffle_winners').select('discord_display_name,loot_items(name,loot_classes(name,color))').eq('raffle_id',r.id);
    const grouped=new Map<string,any>();
    for(const w of winners??[]){
      const key=(w as any).loot_items?.name??'Loot';
      if(!grouped.has(key)) grouped.set(key,{name:key,color:(w as any).loot_items?.loot_classes?.color,className:(w as any).loot_items?.loot_classes?.name,winners:[]});
      grouped.get(key).winners.push((w as any).discord_display_name);
    }
    cards.push({title:`MI ${fmt(r.starts_at)}`,groups:[...grouped.values()]});
  }
  return <main style={{maxWidth:980,margin:'0 auto',padding:'36px 20px'}}>
    <h1 style={{marginBottom:8}}>MI Loot History</h1><p style={{marginTop:0,color:'#98a2b3'}}>Completed raffle results only.</p>
    <div style={{display:'grid',gap:16}}>{cards.map((c,idx)=><article key={idx} style={{border:'1px solid #283244',borderRadius:16,padding:20,background:'#111827'}}><h2 style={{marginTop:0}}>{c.title}</h2>{c.groups.map((g:any)=><div key={g.name} style={{borderLeft:`4px solid ${C[g.color]||'#667085'}`,paddingLeft:12,margin:'14px 0'}}><div style={{fontWeight:700}}>{g.name} ×{g.winners.length}</div><div style={{fontSize:13,color:C[g.color]||'#98a2b3'}}>{g.className}</div><div style={{marginTop:5,color:'#d0d5dd'}}>{g.winners.join(' · ')}</div></div>)}</article>)}</div>
  </main>;
}
