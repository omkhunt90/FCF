import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware';
import { prisma } from '../../db/prisma';

const router = Router();

// GET /api/v1/admin/dashboard — stats overview
router.get('/dashboard', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalParticipants,
      activeParticipants,
      totalSubmissions,
      acceptedSubmissions,
      competition,
    ] = await Promise.all([
      prisma.participant.count(),
      prisma.participant.count({ where: { isActive: true } }),
      prisma.submission.count(),
      prisma.submission.count({ where: { isCorrect: true } }),
      prisma.competition.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { rounds: { orderBy: { roundNumber: 'asc' } } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalParticipants,
        activeParticipants,
        totalSubmissions,
        acceptedSubmissions,
        competition,
        serverTime: Date.now(),
      },
    });
  } catch (e) { next(e); }
});

// GET /api/v1/admin/audit-events — recent audit events
router.get('/audit-events', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await prisma.auditEvent.findMany({
      include: {
        participant: { select: { displayName: true, teamName: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: events });
  } catch (e) { next(e); }
});

// POST /api/v1/admin/competition — create competition
router.post('/competition', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name: string };
    const competition = await prisma.competition.create({
      data: {
        name,
        rounds: {
          create: [
            {
              name: 'Round 1',
              roundNumber: 1,
              durationMs: 30 * 60 * 1000, // 30 minutes
              activities: {
                create: [
                  {
                    name: 'Dumb Charades',
                    type: 'DUMB_CHARADES',
                    durationMs: 15 * 60 * 1000,
                    config: { questionCount: 5, pointsPerQuestion: 10 },
                  },
                  {
                    name: 'Activity B',
                    type: 'FUTURE_ACTIVITY',
                    config: { placeholder: true },
                  },
                ],
              },
            },
            {
              name: 'Round 2',
              roundNumber: 2,
              durationMs: 15 * 60 * 1000, // 15 minutes
              activities: {
                create: [
                  {
                    name: 'Blind Coding',
                    type: 'BLIND_CODING',
                    config: { placeholder: true },
                  },
                ],
              },
            },
          ],
        },
      },
      include: { rounds: { include: { activities: true } } },
    });
    res.status(201).json({ success: true, data: competition });
  } catch (e) { next(e); }
});

export default router;
