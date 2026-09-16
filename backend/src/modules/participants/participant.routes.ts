import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin, requireSelfOrAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as participantService from './participant.service';

const router = Router();

// GET /api/v1/participants — admin only
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await participantService.listParticipants();
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/v1/participants — admin creates participant
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('username')
      .trim()
      .notEmpty()
      .withMessage('Username is required')
      .isLength({ min: 1, max: 50 })
      .withMessage('Username must be between 1 and 50 characters'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 4 })
      .withMessage('Password must be at least 4 characters'),
    body('displayName')
      .trim()
      .notEmpty()
      .withMessage('Display Name is required'),
    body('teamName').optional({ values: 'falsy' }).trim(),
    validate,
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await participantService.createParticipant(req.body as {
        username: string; password: string; displayName: string; teamName?: string;
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// GET /api/v1/participants/:id
router.get('/:id', authenticate, requireSelfOrAdmin('id'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await participantService.getParticipant(req.params.id);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/v1/participants/:id/disable — admin
router.post('/:id/disable', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await participantService.disableParticipant(req.params.id);
    res.json({ success: true, message: 'Participant disabled' });
  } catch (e) { next(e); }
});

// POST /api/v1/participants/:id/enable — admin
router.post('/:id/enable', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await participantService.enableParticipant(req.params.id);
    res.json({ success: true, message: 'Participant enabled' });
  } catch (e) { next(e); }
});

// GET /api/v1/participants/:id/audit-events — admin
router.get('/:id/audit-events', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await participantService.getParticipantAuditEvents(req.params.id);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// PUT /api/v1/participants/:id/question-bank — admin assigns Dumb Charades bank (1/2/3 or null)
router.put(
  '/:id/question-bank',
  authenticate,
  requireAdmin,
  [body('bank').custom((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 3)).withMessage('bank must be 1, 2, 3, or null'), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bank = req.body.bank as number | null;
      const data = await participantService.setQuestionBank(req.params.id, bank);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// DELETE /api/v1/participants/:id — admin removes participant
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await participantService.deleteParticipant(req.params.id);
    res.json({ success: true, message: 'Participant removed successfully' });
  } catch (e) { next(e); }
});

export default router;
