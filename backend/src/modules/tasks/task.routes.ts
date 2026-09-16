import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as taskService from './task.service';

const router = Router();

// GET /api/v1/tasks?activityId=... — authenticated (participant-safe, no correctAnswer)
// For DUMB_CHARADES activities, filters by participant's assignedQuestionBank
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { activityId } = req.query as { activityId?: string };
    if (!activityId) {
      res.status(400).json({ success: false, message: 'activityId required' });
      return;
    }
    // Pass participantId so DUMB_CHARADES bank filtering applies
    const participantId = req.user?.participantId;
    const data = await taskService.getTasksForActivity(activityId, participantId);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// GET /api/v1/tasks/:id/admin — admin with correctAnswer
router.get('/:id/admin', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await taskService.getTaskAdmin(req.params.id);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/v1/tasks — admin creates task
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('activityId').notEmpty(),
    body('title').trim().notEmpty(),
    body('description').trim().notEmpty(),
    body('correctAnswer').optional().trim(),
    body('points').optional().isInt({ min: 0 }),
    body('timeoutMs').optional().isInt({ min: 500, max: 10000 }),
    body('orderIndex').optional().isInt({ min: 0 }),
    body('questionBank').optional({ nullable: true }).isInt({ min: 1, max: 3 }),
    validate,
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await taskService.createTask(req.body as Parameters<typeof taskService.createTask>[0]);
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  }
);

// PUT /api/v1/tasks/:id — admin updates task
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await taskService.updateTask(req.params.id, req.body as Parameters<typeof taskService.updateTask>[1]);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/v1/tasks/:id/toggle — admin
router.post('/:id/toggle', authenticate, requireAdmin,
  [body('isActive').isBoolean(), validate],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await taskService.toggleTask(req.params.id, req.body.isActive as boolean);
      res.json({ success: true });
    } catch (e) { next(e); }
  }
);

// DELETE /api/v1/tasks/:id — admin deletes task
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await taskService.deleteTask(req.params.id);
    res.json({ success: true, message: 'Task deleted' });
  } catch (e) { next(e); }
});

export default router;
