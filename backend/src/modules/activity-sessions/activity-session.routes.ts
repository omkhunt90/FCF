/**
 * Activity session routes — per-participant activity start/end tracking.
 * Participants start their own activity timers; admin has no control.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireParticipant } from '../../middleware/auth.middleware';
import { prisma } from '../../db/prisma';
import { createError } from '../../middleware/error.middleware';
import { logger } from '../../config/logger';

const router = Router();

/**
 * POST /api/v1/activity-sessions/:activityId/start
 * Participant starts an activity — records startedAt, returns session info.
 * Idempotent: if already started, returns existing session.
 */
router.post('/:activityId/start', authenticate, requireParticipant,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { activityId } = req.params;
      const participantId = req.user!.participantId!;

      // Verify activity exists and its round is ACTIVE
      const activity = await prisma.activity.findUnique({
        where: { id: activityId },
        include: { round: true },
      });
      if (!activity) throw createError('Activity not found', 404);
      if (activity.round.status !== 'ACTIVE') throw createError('Round is not active', 400);

      // Upsert: return existing session if already started (idempotent)
      const existing = await prisma.participantActivitySession.findUnique({
        where: { participantId_activityId: { participantId, activityId } },
      });
      if (existing) {
        return res.json({
          success: true,
          data: {
            activityId,
            startedAt: existing.startedAt.toISOString(),
            durationMs: activity.durationMs ?? 900_000,
            alreadyStarted: true,
          },
        });
      }

      const session = await prisma.participantActivitySession.create({
        data: { participantId, activityId },
      });

      logger.info('Participant started activity', { participantId, activityId });

      return res.json({
        success: true,
        data: {
          activityId,
          startedAt: session.startedAt.toISOString(),
          durationMs: activity.durationMs ?? 900_000,
          alreadyStarted: false,
        },
      });
    } catch (e) { return next(e); }
  }
);

/**
 * GET /api/v1/activity-sessions/mine
 * Returns all activity sessions for the current participant.
 * Used to restore timer state after browser refresh.
 */
router.get('/mine', authenticate, requireParticipant,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.user!.participantId!;
      const sessions = await prisma.participantActivitySession.findMany({
        where: { participantId },
        include: { activity: { select: { id: true, name: true, type: true, durationMs: true } } },
      });

      const data = sessions.map(s => ({
        activityId: s.activityId,
        activityName: s.activity.name,
        activityType: s.activity.type,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        durationMs: s.activity.durationMs ?? 900_000,
        remainingMs: s.endedAt
          ? 0
          : Math.max(0, (s.activity.durationMs ?? 900_000) - (Date.now() - s.startedAt.getTime())),
      }));

      return res.json({ success: true, data });
    } catch (e) { return next(e); }
  }
);

export default router;
