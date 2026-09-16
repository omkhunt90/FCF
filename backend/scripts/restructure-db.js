const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const ROUND1_ID = 'cmtypltiw0002e6rg6x48we0u';
  const ROUND2_ID = 'cmtypltix000ae6rgdwz2sr56';
  const TBD_ACTIVITY_ID = 'cmtypltix0009e6rgi4zuicsg';
  const BLIND_CODING_ID = 'cmtypltix000be6rgbkqmhqru';
  const DC_ID = 'cmtypltiw0003e6rgxl83xwsl';

  // 1. Move Blind Coding to Round 1 (idempotent)
  await p.activity.updateMany({ where: { id: BLIND_CODING_ID }, data: { roundId: ROUND1_ID } });
  console.log('1. Ensured Blind Coding is in Round 1');

  // 2. Delete TBD activity if it still exists
  const deleted = await p.activity.deleteMany({ where: { id: TBD_ACTIVITY_ID } });
  console.log('2. Deleted TBD activity (count=' + deleted.count + ')');

  // 3. Clear Round 2 submissions and audit events referencing Round 2, then delete Round 2
  await p.competition.updateMany({
    where: { currentRoundId: ROUND2_ID },
    data: { currentRoundId: null, status: 'NOT_STARTED' },
  });
  await p.submission.deleteMany({ where: { roundId: ROUND2_ID } });
  const r2del = await p.round.deleteMany({ where: { id: ROUND2_ID } });
  console.log('3. Deleted Round 2 (count=' + r2del.count + ')');

  // 4. Reset Round 1 to UPCOMING with Dumb Charades as active activity
  await p.round.update({
    where: { id: ROUND1_ID },
    data: { status: 'UPCOMING', startedAt: null, endedAt: null, activeActivityId: DC_ID },
  });
  await p.activity.updateMany({ where: { roundId: ROUND1_ID }, data: { isActive: false } });
  await p.activity.update({ where: { id: DC_ID }, data: { isActive: true } });
  console.log('4. Reset Round 1 to UPCOMING, Dumb Charades active');

  // 5. Reset competition
  await p.competition.updateMany({ data: { status: 'NOT_STARTED', currentRoundId: null } });
  console.log('5. Competition reset to NOT_STARTED');

  // 6. Clear all transient data (submissions, leaderboard, audit, sessions)
  await p.leaderboardEntry.deleteMany({});
  await p.submission.deleteMany({});
  await p.auditEvent.deleteMany({});
  await p.participantSession.deleteMany({});
  console.log('6. Cleared all transient data');

  // Verify final structure
  const comp = await p.competition.findFirst({
    include: {
      rounds: {
        include: { activities: { orderBy: { createdAt: 'asc' } } },
        orderBy: { roundNumber: 'asc' },
      },
    },
  });
  console.log('\n=== Final structure ===');
  console.log('Competition:', comp.name, '[' + comp.status + ']');
  comp.rounds.forEach(r => {
    console.log('  Round ' + r.roundNumber + ': ' + r.name + ' [' + r.status + ']');
    r.activities.forEach(a => console.log('    Activity: ' + a.name + ' [' + a.type + '] active=' + a.isActive));
  });

  await p.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
