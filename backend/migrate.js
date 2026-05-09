require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function clean(trade) {
  // Only keep fields that are stored in DB (drop computed fields)
  const { status, days_in_trade, invested, pf_percentage, pl, pl_percentage, ...raw } = trade;
  return raw;
}

async function migrate() {
  const dataDir = path.join(__dirname, '../data');

  // Migrate India trades
  const trades = JSON.parse(fs.readFileSync(path.join(dataDir, 'trades.json'), 'utf-8'));
  console.log(`Migrating ${trades.length} India trades...`);
  const { error: e1 } = await supabase.from('trades').insert(trades.map(clean));
  if (e1) { console.error('India trades error:', e1.message); } else { console.log('India trades done.'); }

  // Migrate US trades
  const usTrades = JSON.parse(fs.readFileSync(path.join(dataDir, 'us_trades.json'), 'utf-8'));
  console.log(`Migrating ${usTrades.length} US trades...`);
  const { error: e2 } = await supabase.from('us_trades').insert(usTrades.map(clean));
  if (e2) { console.error('US trades error:', e2.message); } else { console.log('US trades done.'); }

  // Migrate settings
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8'));
  console.log('Migrating settings...');
  const { error: e3 } = await supabase.from('settings').upsert({ id: 1, ...settings });
  if (e3) { console.error('Settings error:', e3.message); } else { console.log('Settings done.'); }

  console.log('\nMigration complete!');
}

migrate().catch(console.error);
