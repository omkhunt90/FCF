import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware';
import { prisma } from '../../db/prisma';


const router = Router();

// ─── Helper ─────────────────────────────────────────────────────────────────

interface LBRow {
  rank: number;
  participantId: string;
  displayName: string;
  teamName: string | null;
  totalScore: number;
  acceptedCount: number;
  totalAttempts: number;
  lastAcceptedAt: string | null;
}

function rankRows(rows: Omit<LBRow, 'rank'>[]): LBRow[] {
  // Sort: score desc, then earliest lastAcceptedAt (tie-break)
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.lastAcceptedAt && b.lastAcceptedAt)
      return new Date(a.lastAcceptedAt).getTime() - new Date(b.lastAcceptedAt).getTime();
    if (a.lastAcceptedAt) return -1;
    if (b.lastAcceptedAt) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ─── Overall leaderboard (aggregated LeaderboardEntry table) ─────────────────

router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await prisma.leaderboardEntry.findMany({
      include: {
        participant: { select: { displayName: true, teamName: true } },
      },
      orderBy: [
        { totalScore: 'desc' },
        { lastAcceptedAt: 'asc' },
      ],
    });

    const ranked = entries.map((entry, index) => ({
      rank: index + 1,
      participantId: entry.participantId,
      displayName: entry.participant.displayName,
      teamName: entry.participant.teamName,
      totalScore: entry.totalScore,
      acceptedCount: entry.acceptedCount,
      totalAttempts: entry.totalSubmissions,
      lastAcceptedAt: entry.lastAcceptedAt?.toISOString() ?? null,
    }));

    res.json({ success: true, data: ranked, scope: 'overall', updatedAt: Date.now() });
  } catch (e) { next(e); }
});

// ─── Round leaderboard (computed live from submissions) ───────────────────────

router.get('/round/:roundId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roundId } = req.params;

    // Fetch all submissions for this round that contributed score
    // Includes: correct submissions (R1) AND CODE_DEBUGGING submissions with score > 0 (R2)
    const subs = await prisma.submission.findMany({
      where: {
        roundId,
        OR: [
          { isCorrect: true },
          { score: { gt: 0 } }, // CODE_DEBUGGING partial/full scores
        ],
      },
      include: {
        participant: { select: { displayName: true, teamName: true } },
        task: { select: { points: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    // All attempt counts
    const attempts = await prisma.submission.groupBy({
      by: ['participantId'],
      where: { roundId },
      _count: { id: true },
    });
    const attemptMap = new Map(attempts.map(a => [a.participantId, a._count.id]));

    // Aggregate per participant.
    // Round 1: one correct sub per task — use task.points.
    // Round 2 CODE_DEBUGGING: may have multiple scored subs per task — use highest sub.score.
    const map = new Map<string, Omit<LBRow, 'rank'>>();
    // Track best score per (participantId, taskId) to handle multiple debug attempts
    const bestTaskScore = new Map<string, number>(); // key: `${pid}-${taskId}`

    for (const sub of subs) {
      const pid = sub.participantId;
      const taskKey = `${pid}-${sub.taskId ?? ''}`;
      // For scored subs: use sub.score if > 0 (debug), else use task.points (R1 correct)
      const subScore = (sub.score ?? 0) > 0 ? (sub.score ?? 0) : (sub.task?.points ?? 0);
      const prev = bestTaskScore.get(taskKey) ?? -1;

      if (subScore <= prev) continue; // not an improvement
      const scoreDelta = subScore - Math.max(0, prev); // incremental delta
      bestTaskScore.set(taskKey, subScore);

      const existing = map.get(pid);
      if (existing) {
        existing.totalScore += scoreDelta;
        if (prev < 0) existing.acceptedCount += 1; // first time scored
        if (!existing.lastAcceptedAt ||
          new Date(sub.submittedAt) > new Date(existing.lastAcceptedAt)) {
          existing.lastAcceptedAt = sub.submittedAt.toISOString();
        }
      } else {
        map.set(pid, {
          participantId: pid,
          displayName: sub.participant.displayName,
          teamName: sub.participant.teamName,
          totalScore: subScore,
          acceptedCount: 1,
          totalAttempts: attemptMap.get(pid) ?? 0,
          lastAcceptedAt: sub.submittedAt.toISOString(),
        });
      }
    }

    // Add participants with 0 score (they attempted but scored nothing)
    for (const [pid, count] of attemptMap) {
      if (!map.has(pid)) {
        const participant = await prisma.participant.findUnique({
          where: { id: pid },
          select: { displayName: true, teamName: true },
        });
        if (participant) {
          map.set(pid, {
            participantId: pid,
            displayName: participant.displayName,
            teamName: participant.teamName,
            totalScore: 0,
            acceptedCount: 0,
            totalAttempts: count,
            lastAcceptedAt: null,
          });
        }
      }
    }

    const round = await prisma.round.findUnique({ where: { id: roundId }, select: { name: true } });
    res.json({
      success: true,
      data: rankRows([...map.values()]),
      scope: 'round',
      scopeName: round?.name ?? roundId,
      updatedAt: Date.now(),
    });
  } catch (e) { next(e); }
});

// ─── Activity leaderboard (computed live from submissions) ────────────────────

router.get('/activity/:activityId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activityId } = req.params;

    // Get activity info
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { name: true, roundId: true },
    });
    if (!activity) {
      res.status(404).json({ success: false, message: 'Activity not found' });
      return;
    }

    // Tasks in this activity
    const taskIds = (await prisma.task.findMany({
      where: { activityId, isActive: true },
      select: { id: true },
    })).map(t => t.id);

    // Correct submissions OR CODE_DEBUGGING scored submissions
    const subs = await prisma.submission.findMany({
      where: {
        taskId: { in: taskIds },
        OR: [
          { isCorrect: true },
          { score: { gt: 0 } },
        ],
      },
      include: {
        participant: { select: { displayName: true, teamName: true } },
        task: { select: { points: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    // All attempt counts for this activity
    const attempts = await prisma.submission.groupBy({
      by: ['participantId'],
      where: { taskId: { in: taskIds } },
      _count: { id: true },
    });
    const attemptMap = new Map(attempts.map(a => [a.participantId, a._count.id]));

    // Aggregate
    const map = new Map<string, Omit<LBRow, 'rank'>>();
    const bestTaskScore = new Map<string, number>();

    for (const sub of subs) {
      const pid = sub.participantId;
      const taskKey = `${pid}-${sub.taskId ?? ''}`;
      const subScore = (sub.score ?? 0) > 0 ? (sub.score ?? 0) : (sub.task?.points ?? 0);
      const prev = bestTaskScore.get(taskKey) ?? -1;

      if (subScore <= prev) continue;
      const scoreDelta = subScore - Math.max(0, prev);
      bestTaskScore.set(taskKey, subScore);

      const existing = map.get(pid);
      if (existing) {
        existing.totalScore += scoreDelta;
        if (prev < 0) existing.acceptedCount += 1;
        if (!existing.lastAcceptedAt ||
          new Date(sub.submittedAt) > new Date(existing.lastAcceptedAt)) {
          existing.lastAcceptedAt = sub.submittedAt.toISOString();
        }
      } else {
        map.set(pid, {
          participantId: pid,
          displayName: sub.participant.displayName,
          teamName: sub.participant.teamName,
          totalScore: subScore,
          acceptedCount: 1,
          totalAttempts: attemptMap.get(pid) ?? 0,
          lastAcceptedAt: sub.submittedAt.toISOString(),
        });
      }
    }

    // Include participants who attempted but scored 0
    for (const [pid, count] of attemptMap) {
      if (!map.has(pid)) {
        const participant = await prisma.participant.findUnique({
          where: { id: pid },
          select: { displayName: true, teamName: true },
        });
        if (participant) {
          map.set(pid, {
            participantId: pid,
            displayName: participant.displayName,
            teamName: participant.teamName,
            totalScore: 0,
            acceptedCount: 0,
            totalAttempts: count,
            lastAcceptedAt: null,
          });
        }
      }
    }

    res.json({
      success: true,
      data: rankRows([...map.values()]),
      scope: 'activity',
      scopeName: activity.name,
      updatedAt: Date.now(),
    });
  } catch (e) { next(e); }
});

export default router;
