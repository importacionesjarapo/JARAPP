import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl) throw new Error("Missing VITE_SUPABASE_URL");

const supabase = createClient(supabaseUrl, supabaseKey);

async function clean() {
  console.log("Fetching GuiasInternacionales...");
  const { data: guias, error: err1 } = await supabase.from('GuiasInternacionales').select('*');
  if (err1) { console.error(err1); return; }
  
  console.log("Fetching Logistica...");
  const { data: logistica, error: err2 } = await supabase.from('Logistica').select('guia_internacional_id');
  if (err2) { console.error(err2); return; }

  const usedIds = new Set(logistica.map(l => l.guia_internacional_id).filter(id => id));

  const orphaned = guias.filter(g => !usedIds.has(g.id));
  
  console.log(`Found ${guias.length} total guias.`);
  console.log(`Found ${usedIds.size} used guias.`);
  console.log(`Found ${orphaned.length} orphaned guias to delete.`);

  for (const g of orphaned) {
    console.log(`Deleting orphaned guia: ${g.id} (Numero: ${g.numero_guia})`);
    await supabase.from('GuiasInternacionales').delete().eq('id', g.id);
  }
  
  console.log("Done cleanup.");
}

clean();
