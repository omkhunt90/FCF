import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireParticipant, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as submissionService from './submission.service';
import { NextFunction, Request, Response } from 'express';

const router = Router();

// POST /api/v1/submissions — participant submits code
router.post(
  '/',
  authenticate,
  requireParticipant,
  [
    body('roundId').notEmpty(),
    body('taskId').notEmpty(),
    body('sourceCode').notEmpty().withMessage('Source code is required'),
    body('isRunOnly').optional().isBoolean(),
    validate,
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await submissionService.submit({
        participantId: req.user!.participantId!,
        roundId: req.body.roundId as string,
        taskId: req.body.taskId as string,
        sourceCode: req.body.sourceCode as string,
        isRunOnly: req.body.isRunOnly as boolean | undefined,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/submissions/mine — participant's own submissions
router.get(
  '/mine',
  authenticate,
  requireParticipant,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await submissionService.getParticipantSubmissions(
        req.user!.participantId!,
        req.query.roundId as string | undefined
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/submissions — admin: all submissions
router.get(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await submissionService.getAllSubmissions(
        req.query.roundId as string | undefined
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/submissions/:id — admin: single submission with full details
router.get(
  '/:id',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await submissionService.getSubmissionAdmin(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/submissions/:id/debug-result — admin: CODE_DEBUGGING per-error breakdown
router.get(
  '/:id/debug-result',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await submissionService.getDebugResult(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

