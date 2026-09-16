import { prisma } from '../../db/prisma';
import { createError } from '../../middleware/error.middleware';
import { TaskView } from '../../types';

// NEVER include correctAnswer in public responses
const SAFE_TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  sampleOutput: true,
  timeoutMs: true,
  points: true,
  orderIndex: true,
  questionBank: true,
  starterCode: true,  // CODE_DEBUGGING: buggy code pre-filled in participant editor
  config: true,       // CODE_DEBUGGING: error definitions (admin only via getTaskAdmin)
  isActive: true,
  // correctAnswer: false — NOT selected
} as const;

/**
 * Get tasks for an activity.
 * For DUMB_CHARADES: strictly filter by participant's assignedQuestionBank.
 * If no bank assigned, return empty (admin must assign bank first).
 * For BLIND_CODING and others: return all active tasks (no bank filtering).
 */
export async function getTasksForActivity(
  activityId: string,
  participantId?: string
): Promise<TaskView[]> {
  // Fetch activity type to determine filtering
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { type: true },
  });
  if (!activity) throw createError('Activity not found', 404);

  if (activity.type === 'DUMB_CHARADES' && participantId) {
    // Strict bank filtering: participant must have an assigned bank
    const participant = await prisma.participant.findUnique({
      where: { id: participantId },
      select: { assignedQuestionBank: true },
    });
    const bank = participant?.assignedQuestionBank ?? null;
    if (bank === null) {
      // No bank assigned — return empty; admin must assign one
      return [];
    }
    return prisma.task.findMany({
      where: { activityId, isActive: true, questionBank: bank },
      select: SAFE_TASK_SELECT,
      orderBy: { orderIndex: 'asc' },
    });
  }

  // BLIND_CODING / FUTURE_ACTIVITY: no bank filtering
  return prisma.task.findMany({
    where: { activityId, isActive: true },
    select: SAFE_TASK_SELECT,
    orderBy: { orderIndex: 'asc' },
  });
}

export interface CreateTaskInput {
  activityId: string;
  title: string;
  description: string;
  correctAnswer?: string;
  inputSpec?: string;
  sampleOutput?: string;
  timeoutMs?: number;
  memoryLimitMb?: number;
  points?: number;
  maxAttempts?: number;
  orderIndex?: number;
  questionBank?: number | null; // 1, 2, or 3 for Dumb Charades
  starterCode?: string;         // CODE_DEBUGGING: buggy code shown in participant editor
  config?: Record<string, unknown>; // CODE_DEBUGGING: [{id, description, fixRegex}]
}

export async function createTask(input: CreateTaskInput) {
  const activity = await prisma.activity.findUnique({ where: { id: input.activityId } });
  if (!activity) throw createError('Activity not found', 404);

  return prisma.task.create({
    data: {
      activityId: input.activityId,
      title: input.title,
      description: input.description,
      // Store answer as-is (admin stores lowercase per competition rules)
      correctAnswer: input.correctAnswer,
      inputSpec: input.inputSpec,
      sampleOutput: input.sampleOutput,
      timeoutMs: input.timeoutMs ?? 2000,
      memoryLimitMb: input.memoryLimitMb ?? 64,
      points: input.points ?? 10,
      maxAttempts: input.maxAttempts ?? null,
      orderIndex: input.orderIndex ?? 0,
      questionBank: input.questionBank ?? null,
      starterCode: input.starterCode ?? null,
      config: input.config ? (input.config as import('@prisma/client').Prisma.InputJsonValue) : undefined,
    },
    select: { ...SAFE_TASK_SELECT, correctAnswer: true, config: true }, // admin can see answer + config
  });
}

export async function updateTask(taskId: string, input: Partial<CreateTaskInput>) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw createError('Task not found', 404);

  // Destructure to exclude activityId (relation — not updatable directly)
  const { activityId: _activityId, config, ...rest } = input;

  return prisma.task.update({
    where: { id: taskId },
    data: {
      ...rest,
      config: config ? (config as import('@prisma/client').Prisma.InputJsonValue) : undefined,
    },
    select: { ...SAFE_TASK_SELECT, correctAnswer: true, config: true },
  });
}

export async function toggleTask(taskId: string, isActive: boolean) {
  return prisma.task.update({ where: { id: taskId }, data: { isActive } });
}

export async function getTaskAdmin(taskId: string) {
  // Admin can see correctAnswer
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw createError('Task not found', 404);
  return task;
}

export async function deleteTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw createError('Task not found', 404);

  // Check if task has submissions
  const submissionCount = await prisma.submission.count({ where: { taskId } });
  if (submissionCount > 0) {
    throw createError('Cannot delete task with existing submissions. Deactivate it instead.', 400);
  }

  await prisma.task.delete({ where: { id: taskId } });
}
