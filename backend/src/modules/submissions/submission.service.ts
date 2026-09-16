import { prisma } from '../../db/prisma';
import { executeCode, compareAnswer, normalizeOutput } from '../../services/compiler.service';
import { socketService } from '../../services/socket.service';
import { createError } from '../../middleware/error.middleware';
import { logger } from '../../config/logger';
import { SubmissionResult } from '../../types';
import { isRoundActive } from '../competition/competition.service';
import { evaluateDebugging, type ErrorDefinition } from './debug-diff.service';
import { timerService } from '../../services/timer.service';

// Round 3 test case type
interface TestCase {
  label?: string;
  input: string;
  expectedOutput: string;
  /** LeetCode-style hidden driver: if present, concatenated with participant code and compiled together. stdin is not used. */
  driverCode?: string;
}

interface SubmitRequest {
  participantId: string;
  roundId: string;
  taskId: string;
  sourceCode: string;
  isRunOnly?: boolean; // true = compile+run but don't compare answer
}

export async function submit(req: SubmitRequest): Promise<SubmissionResult> {
  const { participantId, roundId, taskId, sourceCode, isRunOnly = false } = req;

  // 1. Verify round is still active
  const active = await isRoundActive(roundId);
  if (!active) {
    throw createError('Round is not active. Submissions closed.', 403);
  }

  // 2. Load task (NEVER expose correctAnswer to client)
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      correctAnswer: true, // backend only
      starterCode: true,
      timeoutMs: true,
      memoryLimitMb: true,
      points: true,
      inputSpec: true,
      activityId: true,
      config: true,        // CODE_DEBUGGING: error definitions
      activity: { select: { type: true } }, // needed to detect BLIND_CODING / CODE_DEBUGGING
    },
  });
  if (!task || !task) throw createError('Task not found', 404);
  const isBlindCoding = task.activity?.type === 'BLIND_CODING';
  const isCodeDebugging = task.activity?.type === 'CODE_DEBUGGING';
  const isCodingSprint = task.activity?.type === 'CODING_SPRINT';

  // 2a. For CODING_SPRINT: check freeze and per-participant timer
  if (isCodingSprint) {
    if (timerService.isParticipantFrozen(participantId)) {
      throw createError('Your keyboard is currently frozen. Please wait for the freeze to expire.', 403);
    }
    // Check per-participant remaining timer
    const personalRemaining = timerService.getParticipantRemainingMs(participantId, roundId);
    if (personalRemaining !== null && personalRemaining <= 0) {
      throw createError('Your time has expired. No more submissions allowed.', 403);
    }
  }

  // 2b. Validate per-participant activity session time window
  // Round 1 only (DUMB_CHARADES, BLIND_CODING). Round 2 (CODE_DEBUGGING) and Round 3 (CODING_SPRINT) use admin-controlled round-level timer.
  if (task.activityId && !isCodeDebugging && !isCodingSprint) {
    const activity = await prisma.activity.findUnique({
      where: { id: task.activityId },
      select: { durationMs: true },
    });
    const activitySession = await prisma.participantActivitySession.findUnique({
      where: { participantId_activityId: { participantId, activityId: task.activityId } },
    });
    if (!activitySession) {
      throw createError('You have not started this activity yet.', 403);
    }
    const durationMs = activity?.durationMs ?? 900_000;
    const elapsed = Date.now() - activitySession.startedAt.getTime();
    if (elapsed > durationMs) {
      throw createError('Activity time expired. No more submissions allowed for this activity.', 403);
    }
  }

  // 3. Check if already solved (task locked after correct answer)
  // For BLIND_CODING, CODE_DEBUGGING, CODING_SPRINT: allow multiple submissions
  if (!isRunOnly && !isBlindCoding && !isCodeDebugging && !isCodingSprint) {
    const previousCorrect = await prisma.submission.findFirst({
      where: { participantId, taskId, isCorrect: true },
    });
    if (previousCorrect) {
      throw createError('Task already solved', 400);
    }
  }

  // ── CODE_DEBUGGING fast path — single submission only ────────────────────────
  if (isCodeDebugging) {
    const existingSubmission = await prisma.submission.findFirst({
      where: { participantId, taskId },
    });
    if (existingSubmission) {
      throw createError('You have already submitted your solution for Round 2. Only one submission is allowed.', 400);
    }

    const taskConfig = task.config as { errors?: ErrorDefinition[] } | null;
    const errors: ErrorDefinition[] = taskConfig?.errors ?? [];

    // Evaluate per-error independently
    const debugResult = evaluateDebugging(sourceCode, errors, task.starterCode);

    // Count previous attempts and find best prior score for delta calculation
    const attemptCount = await prisma.submission.count({
      where: { participantId, taskId },
    });
    const prevBest = await prisma.submission.findFirst({
      where: { participantId, taskId },
      orderBy: { score: 'desc' },
      select: { score: true },
    });
    const prevBestScore = prevBest?.score ?? 0;

    // Persist with real score (admin-visible), neutral status for participant
    const submission = await prisma.submission.create({
      data: {
        participantId,
        roundId,
        taskId,
        attemptNumber: attemptCount + 1,
        sourceCode,
        language: 'c',
        // Store actual result for admin — never revealed to participant via API
        status: 'ACCEPTED',
        isCorrect: debugResult.fixedCount === errors.length,
        score: debugResult.score,
        // compilerResult reused to store full debug breakdown for admin endpoint
        compilerResult: debugResult as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    // Update leaderboard with delta (only if this submission improves the best score)
    const scoreDelta = Math.max(0, debugResult.score - prevBestScore);
    if (scoreDelta > 0) {
      await updateLeaderboard(participantId, scoreDelta);
      const updatedEntries = await getRankedLeaderboard();
      socketService.emitLeaderboardUpdate(updatedEntries);
    }

    // Save/update participant session (persist code)
    await prisma.participantSession.upsert({
      where: { participantId_roundId: { participantId, roundId } },
      update: { currentCode: sourceCode, lastSeenAt: new Date() },
      create: { participantId, roundId, currentCode: sourceCode },
    });

    logger.info('CODE_DEBUGGING submission processed', {
      submissionId: submission.id,
      participantId,
      taskId,
      fixedCount: debugResult.fixedCount,
      score: debugResult.score,
      scoreDelta,
    });

    // Neutral result — participant never learns score or fixed count
    const result: SubmissionResult = {
      submissionId: submission.id,
      status: 'PENDING' as const,  // neutral
      isCorrect: false,             // hidden
      score: 0,                     // hidden
      attemptNumber: submission.attemptNumber,
      message: 'Code submitted successfully.',
    };

    socketService.emitSubmissionResult(participantId, result);
    return result;
  }
  // ── End CODE_DEBUGGING fast path ─────────────────────────────────────────────

  // ── CODING_SPRINT fast path ───────────────────────────────────────────────────
  if (isCodingSprint) {
    const taskConfig = task.config as { testCases?: TestCase[] } | null;
    const testCases: TestCase[] = taskConfig?.testCases ?? [];

    if (testCases.length === 0) {
      throw createError('No test cases configured for this task.', 400);
    }

    // Run code against all test cases
    const testResults: Array<{
      label: string;
      passed: boolean;
      stdout: string;
      stderr: string;
      compileError: string | null;
      executionTimeMs: number;
      expectedOutput: string;
    }> = [];

    let compileError: string | null = null;

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];

      // LeetCode-style: if driverCode is provided, concatenate participant function + hidden driver
      // Otherwise fall back to legacy stdin mode
      const usesDriver = !!tc.driverCode;
      const fullCode = usesDriver
        ? `${sourceCode}\n\n${tc.driverCode}`
        : sourceCode;

      const execResult = await executeCode({
        language: 'c',
        sourceCode: fullCode,
        stdin: usesDriver ? '' : (tc.input ?? ''),
        timeoutMs: task.timeoutMs,
        memoryLimitMb: task.memoryLimitMb ?? 64,
      });

      if (!compileError && execResult.compileError) {
        compileError = execResult.compileError;
      }

      const actualOut = normalizeOutput(execResult.stdout ?? '');
      const expectedOut = normalizeOutput(tc.expectedOutput ?? '');
      const passed = execResult.success && actualOut === expectedOut;

      testResults.push({
        label: tc.label ?? `Test Case ${i + 1}`,
        passed,
        stdout: execResult.stdout ?? '',
        stderr: execResult.stderr ?? '',
        compileError: execResult.compileError ?? null,
        executionTimeMs: execResult.executionTimeMs ?? 0,
        expectedOutput: tc.expectedOutput ?? '',
      });

      // Short-circuit on compile error (all test cases will fail)
      if (execResult.compileError) break;
    }

    const allPassed = testResults.every(r => r.passed) && !compileError;

    // For isRunOnly: return test case results without saving a full submission
    if (isRunOnly) {
      const result: SubmissionResult = {
        submissionId: '',
        status: compileError ? 'COMPILE_ERROR' : (allPassed ? 'ACCEPTED' : 'WRONG_ANSWER'),
        isCorrect: allPassed,
        score: 0,
        attemptNumber: 0,
        message: compileError
          ? 'Compilation failed. Fix the errors and try again.'
          : allPassed
            ? 'All test cases passed! You can now submit your solution.'
            : 'Some test cases failed. Check the output and fix your code.',
        compileError: compileError ?? undefined,
        testResults,
      } as unknown as SubmissionResult;
      return result;
    }

    // For submit: only allowed if all test cases pass
    if (!allPassed) {
      throw createError('You cannot submit until all test cases pass. Run your code first to check.', 400);
    }

    // Check if already submitted a winning solution
    const existingWin = await prisma.submission.findFirst({
      where: { participantId, taskId, isCorrect: true },
    });
    if (existingWin) {
      throw createError('You have already submitted a passing solution.', 400);
    }

    // Record winning submission (no score — time-based winner determination)
    const attemptCount = await prisma.submission.count({ where: { participantId, taskId } });
    const submission = await prisma.submission.create({
      data: {
        participantId,
        roundId,
        taskId,
        attemptNumber: attemptCount + 1,
        sourceCode,
        language: 'c',
        status: 'ACCEPTED',
        isCorrect: true,
        score: 0, // No points in Round 3 — winner determined by submission time
        compilerResult: { testResults } as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    await prisma.participantSession.upsert({
      where: { participantId_roundId: { participantId, roundId } },
      update: { currentCode: sourceCode, lastSeenAt: new Date() },
      create: { participantId, roundId, currentCode: sourceCode },
    });

    logger.info('CODING_SPRINT winning submission recorded', { submissionId: submission.id, participantId, taskId });

    const result: SubmissionResult = {
      submissionId: submission.id,
      status: 'ACCEPTED',
      isCorrect: true,
      score: 0,
      attemptNumber: submission.attemptNumber,
      message: '🏆 Solution submitted! All test cases passed. The admin will determine the winner by submission time.',
      testResults,
    } as unknown as SubmissionResult;

    socketService.emitSubmissionResult(participantId, result);
    return result;
  }
  // ── End CODING_SPRINT fast path ───────────────────────────────────────────────


  // 4. Count attempts for this participant+task

  const attemptCount = await prisma.submission.count({
    where: { participantId, taskId, isCorrect: false },
  });

  // 5. Execute code via compiler service
  logger.info('Executing submission', { participantId, taskId, isRunOnly });

  const compilerResult = await executeCode({
    language: 'c',
    sourceCode,
    stdin: task.inputSpec ?? '',
    timeoutMs: task.timeoutMs,
    memoryLimitMb: task.memoryLimitMb ?? 64,
  });

  // 6. Map compiler status to submission status
  let submissionStatus: 'PENDING' | 'COMPILING' | 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'MEMORY_LIMIT_EXCEEDED' | 'SYSTEM_ERROR' = 'PENDING';
  let isCorrect = false;
  let score = 0;
  let message = '';

  if (!compilerResult.success) {
    switch (compilerResult.status) {
      case 'compile_error':
        submissionStatus = 'COMPILE_ERROR';
        message = 'Compilation failed. Check your code.';
        break;
      case 'runtime_error':
        submissionStatus = 'RUNTIME_ERROR';
        message = 'Runtime error. Check for undefined behavior.';
        break;
      case 'time_limit_exceeded':
        submissionStatus = 'TIME_LIMIT_EXCEEDED';
        message = 'Time limit exceeded.';
        break;
      case 'memory_limit_exceeded':
        submissionStatus = 'MEMORY_LIMIT_EXCEEDED';
        message = 'Memory limit exceeded.';
        break;
      default:
        submissionStatus = 'SYSTEM_ERROR';
        message = 'System error. Please try again.';
    }
  } else if (isRunOnly) {
    // Just a run — show output, no answer comparison
    submissionStatus = 'ACCEPTED';
    message = 'Code ran successfully.';
  } else {
    // Compare answer — BACKEND ONLY
    if (task.correctAnswer) {
      isCorrect = compareAnswer(compilerResult.stdout, task.correctAnswer);
      if (isCorrect) {
        submissionStatus = 'ACCEPTED';
        score = task.points;
        message = 'Correct! Well done.';
      } else {
        submissionStatus = 'WRONG_ANSWER';
        message = 'Wrong answer. Try again.';
      }
    } else {
      // No correctAnswer configured — just show output (open-ended run)
      submissionStatus = 'ACCEPTED';
      message = 'Code executed successfully.';
    }
  }

  // 7. Save submission (full result stored backend-only)
  const submission = await prisma.submission.create({
    data: {
      participantId,
      roundId,
      taskId,
      attemptNumber: attemptCount + 1,
      sourceCode,
      language: 'c',
      status: submissionStatus,
      isCorrect,
      compileError: compilerResult.compileError,
      stdout: compilerResult.stdout,
      stderr: compilerResult.stderr,
      executionTimeMs: compilerResult.executionTimeMs,
      score: isCorrect ? score : 0,
      compilerResult: compilerResult as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  });

  // 8. If correct, update leaderboard and emit real-time update
  if (isCorrect) {
    await updateLeaderboard(participantId, score);
    const updatedEntries = await getRankedLeaderboard();
    socketService.emitLeaderboardUpdate(updatedEntries);
  }

  // 9. Save/update participant session (persist code)
  await prisma.participantSession.upsert({
    where: { participantId_roundId: { participantId, roundId } },
    update: { currentCode: sourceCode, lastSeenAt: new Date() },
    create: { participantId, roundId, currentCode: sourceCode },
  });

  // 10. Build safe result for client — NEVER include correctAnswer or raw stdout if sensitive
  // For BLIND_CODING non-run submissions: sanitize result — participant sees only neutral confirmation
  const result: SubmissionResult = isBlindCoding && !isRunOnly
    ? {
        submissionId: submission.id,
        status: 'PENDING' as const,  // neutral — don't reveal actual status
        isCorrect: false,             // hidden
        score: 0,                     // hidden
        attemptNumber: submission.attemptNumber,
        message: 'Code submitted successfully.',
        // Show compile errors only — these don't reveal the answer and help participant know if code won't run
        ...(compilerResult.compileError ? { compileError: compilerResult.compileError } : {}),
      }
    : {
        submissionId: submission.id,
        status: submissionStatus,
        isCorrect,
        score: isCorrect ? score : 0,
        attemptNumber: submission.attemptNumber,
        message,
        executionTimeMs: compilerResult.executionTimeMs,
        // Show compile errors and stderr — these don't reveal the answer
        ...(compilerResult.compileError ? { compileError: compilerResult.compileError } : {}),
        ...(compilerResult.stderr ? { stderr: compilerResult.stderr } : {}),
        // Show stdout only for run-only or non-answer tasks
        ...(isRunOnly ? { stdout: compilerResult.stdout } : {}),
      };

  // 11. Emit socket event to participant
  socketService.emitSubmissionResult(participantId, result);

  logger.info('Submission processed', {
    submissionId: submission.id,
    participantId,
    taskId,
    status: submissionStatus,
    isCorrect,
  });

  return result;
}

async function updateLeaderboard(participantId: string, scoreAwarded: number): Promise<void> {
  await prisma.leaderboardEntry.upsert({
    where: { participantId },
    update: {
      totalScore: { increment: scoreAwarded },
      acceptedCount: { increment: 1 },
      totalSubmissions: { increment: 1 },
      lastAcceptedAt: new Date(),
    },
    create: {
      participantId,
      totalScore: scoreAwarded,
      totalSubmissions: 1,
      acceptedCount: 1,
      lastAcceptedAt: new Date(),
    },
  });
}

export async function getParticipantSubmissions(participantId: string, roundId?: string) {
  return prisma.submission.findMany({
    where: { participantId, ...(roundId ? { roundId } : {}) },
    select: {
      id: true,
      taskId: true,
      attemptNumber: true,
      status: true,
      isCorrect: true,
      score: true,
      compileError: true,
      // stdout NOT included — could reveal answer indirectly
      stderr: true,
      executionTimeMs: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: 'desc' },
  });
}

export async function getAllSubmissions(roundId?: string) {
  return prisma.submission.findMany({
    where: roundId ? { roundId } : {},
    include: {
      participant: { select: { displayName: true, teamName: true } },
      task: { select: { title: true, points: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });
}

export async function getSubmissionAdmin(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      participant: { select: { displayName: true, teamName: true } },
      task: { select: { title: true, points: true, correctAnswer: true } },
    },
  });

  if (!submission) {
    throw createError('Submission not found', 404);
  }

  return {
    ...submission,
    task: submission.task ? {
      ...submission.task,
      correctAnswer: undefined, // Never expose to client
    } : null,
  };
}

export async function getRankedLeaderboard(): Promise<object[]> {
  const entries = await prisma.leaderboardEntry.findMany({
    include: {
      participant: { select: { displayName: true, teamName: true } },
    },
    orderBy: [
      { totalScore: 'desc' },
      { lastAcceptedAt: 'asc' },
    ],
  });

  return entries.map((entry, index) => ({
    rank: index + 1,
    participantId: entry.participantId,
    displayName: entry.participant.displayName,
    teamName: entry.participant.teamName,
    totalScore: entry.totalScore,
    acceptedCount: entry.acceptedCount,
    lastAcceptedAt: entry.lastAcceptedAt,
  }));
}

/**
 * Admin-only: returns the full per-error debug breakdown for a CODE_DEBUGGING submission.
 * The compilerResult JSON field stores the DebugDiffResult object.
 */
export async function getDebugResult(submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      participant: { select: { displayName: true, teamName: true } },
      task: { select: { title: true, points: true, activity: { select: { type: true } } } },
    },
  });

  if (!submission) {
    throw createError('Submission not found', 404);
  }
  if (submission.task?.activity?.type !== 'CODE_DEBUGGING') {
    throw createError('This submission is not a CODE_DEBUGGING submission', 400);
  }

  return {
    submissionId: submission.id,
    participantName: submission.participant.displayName,
    teamName: submission.participant.teamName,
    taskTitle: submission.task?.title ?? 'Unknown',
    attemptNumber: submission.attemptNumber,
    submittedAt: submission.submittedAt,
    totalScore: submission.score ?? 0,
    isAllCorrect: submission.isCorrect,
    // compilerResult holds the full DebugDiffResult
    debugResult: submission.compilerResult ?? null,
  };
}

