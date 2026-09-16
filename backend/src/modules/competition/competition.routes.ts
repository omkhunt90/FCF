import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as competitionService from './competition.service';
import { prisma } from '../../db/prisma';

const router = Router();

// GET /api/v1/competition — current competition state (anyone authenticated)
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Auto-start Round 1 when a participant first connects (no admin involvement needed)
    if (req.user?.role === 'PARTICIPANT') {
      await competitionService.autoStartRound1IfNeeded();
    }

    const competition = await competitionService.getCompetition();
    const timerInfo = competition.currentRoundId
      ? competitionService.getRoundStatus(competition.currentRoundId)
      : null;

    res.json({
      success: true,
      data: {
        ...competition,
        serverTime: Date.now(),
        ...(timerInfo ? { timerInfo: await timerInfo } : {}),
      },
    });
  } catch (e) { next(e); }
});

// POST /api/v1/competition/start — admin
router.post('/start', authenticate, requireAdmin,
  [body('competitionId').notEmpty(), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await competitionService.startCompetition(req.body.competitionId as string);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/rounds/:roundId/start — admin starts a round
router.post('/rounds/:roundId/start', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await competitionService.startRound(req.params.roundId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/rounds/:roundId/end — admin ends a round
router.post('/rounds/:roundId/end', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await competitionService.endRound(req.params.roundId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/rounds/:roundId/pause — admin pauses a round
router.post('/rounds/:roundId/pause', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await competitionService.pauseRound(req.params.roundId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/rounds/:roundId/resume — admin resumes a round
router.post('/rounds/:roundId/resume', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await competitionService.resumeRound(req.params.roundId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// PUT /api/v1/competition/rounds/:roundId/activity — admin sets active activity
router.put('/rounds/:roundId/activity', authenticate, requireAdmin,
  [body('activityId').notEmpty(), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await competitionService.setActiveActivity(req.params.roundId, req.body.activityId as string);
      res.json({ success: true, message: 'Active activity updated' });
    } catch (e) { next(e); }
  }
);

// PATCH /api/v1/competition/activities/:activityId — admin updates activity metadata (name, type)
router.patch('/activities/:activityId', authenticate, requireAdmin,
  [body('type').optional().isString(), body('name').optional().isString(), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { activityId } = req.params;
      const { type, name, durationMs } = req.body as { type?: string; name?: string; durationMs?: number };
      const updated = await prisma.activity.update({
        where: { id: activityId },
        data: {
          ...(type !== undefined && { type: type as import('@prisma/client').ActivityType }),
          ...(name !== undefined && { name }),
          ...(durationMs !== undefined && { durationMs }),
        },
      });
      res.json({ success: true, data: updated });
    } catch (e) { next(e); }
  }
);

// GET /api/v1/competition/rounds/:roundId/status
router.get('/rounds/:roundId/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await competitionService.getRoundStatus(req.params.roundId);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/v1/competition/rounds — admin creates a round
router.post('/rounds', authenticate, requireAdmin,
  [body('name').trim().notEmpty(), body('roundNumber').isInt({ min: 1 }), body('durationMs').isInt({ min: 1 }), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const competition = await prisma.competition.findFirst({ select: { id: true } });
      if (!competition) { res.status(404).json({ success: false, message: 'No competition found' }); return; }
      const { name, roundNumber, durationMs } = req.body as { name: string; roundNumber: number; durationMs: number };
      const round = await prisma.round.create({
        data: { competitionId: competition.id, name, roundNumber, durationMs, status: 'UPCOMING' },
        include: { activities: true },
      });
      res.status(201).json({ success: true, data: round });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/rounds/:roundId/activities — admin creates an activity in a round
router.post('/rounds/:roundId/activities', authenticate, requireAdmin,
  [body('name').trim().notEmpty(), body('type').notEmpty(), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, type, durationMs, config } = req.body as { name: string; type: string; durationMs?: number; config?: object };
      const activity = await prisma.activity.create({
        data: {
          roundId: req.params.roundId,
          name,
          type: type as import('@prisma/client').ActivityType,
          durationMs: durationMs ?? 1200000,
          config: config ?? {},
          isActive: true,
        },
      });
      // Set as active activity for this round
      await prisma.round.update({ where: { id: req.params.roundId }, data: { activeActivityId: activity.id } });
      res.status(201).json({ success: true, data: activity });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/setup-round2 — creates Round 2 + CODE_DEBUGGING activity if missing
router.post('/setup-round2', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const competition = await prisma.competition.findFirst({
        select: { id: true },
      });
      if (!competition) { res.status(404).json({ success: false, message: 'No competition found' }); return; }

      // Check if Round 2 already exists
      const existing = await prisma.round.findFirst({
        where: { competitionId: competition.id, roundNumber: 2 },
        include: { activities: true },
      });

      if (existing) {
        // Check if CODE_DEBUGGING activity exists
        const debugActivity = existing.activities.find(a => a.type === 'CODE_DEBUGGING');
        if (debugActivity) {
          res.json({ success: true, message: 'Round 2 with CODE_DEBUGGING already exists', data: existing });
          return;
        }
        // Create CODE_DEBUGGING activity in existing Round 2
        const act = await prisma.activity.create({
          data: {
            roundId: existing.id,
            name: 'Code Debugging',
            type: 'CODE_DEBUGGING',
            durationMs: 20 * 60 * 1000,
            config: { note: 'Configure via Task Management' },
            isActive: true,
          },
        });
        await prisma.round.update({ where: { id: existing.id }, data: { activeActivityId: act.id } });
        res.json({ success: true, message: 'CODE_DEBUGGING activity added to existing Round 2', data: act });
        return;
      }

      // Create Round 2
      const round2 = await prisma.round.create({
        data: {
          competitionId: competition.id,
          name: 'Round 2',
          roundNumber: 2,
          durationMs: 20 * 60 * 1000,
          status: 'UPCOMING',
        },
      });

      // Create CODE_DEBUGGING activity
      const activity = await prisma.activity.create({
        data: {
          roundId: round2.id,
          name: 'Code Debugging',
          type: 'CODE_DEBUGGING',
          durationMs: 20 * 60 * 1000,
          config: { note: 'Configure via Task Management' },
          isActive: true,
        },
      });

      await prisma.round.update({ where: { id: round2.id }, data: { activeActivityId: activity.id } });

      res.status(201).json({
        success: true,
        message: 'Round 2 (Code Debugging, 20 min) created successfully',
        data: { round: round2, activity },
      });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/reset — admin resets entire competition for retesting
router.post('/reset', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await competitionService.resetCompetition();
      res.json({ success: true, message: 'Competition reset successfully. All scores, submissions and timers cleared.' });
    } catch (e) { next(e); }
  }
);

// POST /api/v1/competition/setup-round3 — creates Round 3 + CODING_SPRINT activity if missing
router.post('/setup-round3', authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const competition = await prisma.competition.findFirst({ select: { id: true } });
      if (!competition) { res.status(404).json({ success: false, message: 'No competition found' }); return; }

      // Check if Round 3 already exists
      const existing = await prisma.round.findFirst({
        where: { competitionId: competition.id, roundNumber: 3 },
        include: { activities: true },
      });

      if (existing) {
        const sprintActivity = existing.activities.find(a => a.type === 'CODING_SPRINT');
        if (sprintActivity) {
          res.json({ success: true, message: 'Round 3 with CODING_SPRINT already exists', data: existing });
          return;
        }
        const act = await prisma.activity.create({
          data: {
            roundId: existing.id,
            name: 'Coding Sprint',
            type: 'CODING_SPRINT',
            durationMs: 30 * 60 * 1000,
            config: { note: 'Configure via Task Management' },
            isActive: true,
          },
        });
        await prisma.round.update({ where: { id: existing.id }, data: { activeActivityId: act.id } });
        res.json({ success: true, message: 'CODING_SPRINT activity added to existing Round 3', data: act });
        return;
      }

      // Create Round 3
      const round3 = await prisma.round.create({
        data: {
          competitionId: competition.id,
          name: 'Round 3',
          roundNumber: 3,
          durationMs: 30 * 60 * 1000,
          status: 'UPCOMING',
        },
      });

      const activity = await prisma.activity.create({
        data: {
          roundId: round3.id,
          name: 'Coding Sprint',
          type: 'CODING_SPRINT',
          durationMs: 30 * 60 * 1000,
          config: { note: 'Configure via Task Management' },
          isActive: true,
        },
      });

      await prisma.round.update({ where: { id: round3.id }, data: { activeActivityId: activity.id } });

      res.status(201).json({
        success: true,
        message: 'Round 3 (Coding Sprint, 30 min) created successfully',
        data: { round: round3, activity },
      });
    } catch (e) { next(e); }
  }
);

export default router;
