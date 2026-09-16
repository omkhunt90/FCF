const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.activity.updateMany({
  where: { roundId: 'cmtypltiw0002e6rg6x48we0u' },
  data: { durationMs: 900000 },
}).then(r => {
  console.log('Updated', r.count, 'activities to 15 min (900000ms)');
  return p.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });
