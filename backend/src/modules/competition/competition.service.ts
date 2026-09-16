import { prisma } from '../../db/prisma';
import { CompetitionStatus, RoundStatus } from '@prisma/client';
import { createError } from '../../middleware/error.middleware';
import { logger } from '../../config/logger';
import { timerService } from '../../services/timer.service';
import { socketService } from '../../services/socket.service';

// Valid state transitions
const COMPETITION_TRANSITIONS: Record<CompetitionStatus, CompetitionStatus[]> = {
  NOT_STARTED: ['READY'],
  READY: ['RUNNING', 'NOT_STARTED'],
  RUNNING: ['PAUSED', 'COMPLETED'],
  PAUSED: ['RUNNING', 'COMPLETED'],
  COMPLETED: [],
};

const ROUND_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  UPCOMING: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'ENDED'],
  PAUSED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

function assertCompetitionTransition(from: CompetitionStatus, to: CompetitionStatus): void {
  if (!COMPETITION_TRANSITIONS[from].includes(to)) {
    throw createError(
      `Invalid competition state transition: ${from} → ${to}`,
      400
    );
  }
}

function assertRoundTransition(from: RoundStatus, to: RoundStatus): void {
  if (!ROUND_TRANSITIONS[from].includes(to)) {
    throw createError(`Invalid round state transition: ${from} → ${to}`, 400);
  }
}

export async function getCompetition() {
  const competition = await prisma.competition.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      rounds: {
        include: {
          activities: {
            include: { tasks: { where: { isActive: true }, orderBy: { orderIndex: 'asc' } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { roundNumber: 'asc' },
      },
    },
  });

  if (!competition) {
    throw createError('No competition configured', 404);
  }

  return competition;
}

export async function startCompetition(competitionId: string) {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
  });
  if (!competition) throw createError('Competition not found', 404);

  assertCompetitionTransition(competition.status, 'READY');

  const updated = await prisma.competition.update({
    where: { id: competitionId },
    data: { status: 'READY' },
  });

  socketService.emitCompetitionStateChange(updated.status, updated.currentRoundId);
  logger.info('Competition moved to READY', { competitionId });
  return updated;
}

export async function startRound(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  assertRoundTransition(round.status, 'ACTIVE');

  const now = new Date();
  const endAt = new Date(now.getTime() + round.durationMs);

  // End any other active/paused rounds in this competition so multiple rounds never run at once
  await prisma.round.updateMany({
    where: {
      competitionId: round.competitionId,
      id: { not: roundId },
      status: { in: ['ACTIVE', 'PAUSED'] },
    },
    data: { status: 'ENDED', endedAt: now },
  });

  const updated = await prisma.round.update({
    where: { id: roundId },
    data: { status: 'ACTIVE', startedAt: now },
  });

  // Update competition currentRound
  await prisma.competition.update({
    where: { id: round.competitionId },
    data: { status: 'RUNNING', currentRoundId: roundId },
  });

  // Start server-authoritative timer
  timerService.startRoundTimer(roundId, round.durationMs, now, endAt);

  socketService.emitCompetitionStateChange('RUNNING', roundId);
  socketService.emitRoundStateChange(roundId, 'ACTIVE', now, round.durationMs);
  logger.info('Round started', { roundId, durationMs: round.durationMs });
  return updated;
}

export async function endRound(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  assertRoundTransition(round.status, 'ENDED');

  const now = new Date();
  const updated = await prisma.round.update({
    where: { id: roundId },
    data: { status: 'ENDED', endedAt: now },
  });

  timerService.stopRoundTimer(roundId);
  socketService.emitRoundStateChange(roundId, 'ENDED', round.startedAt, round.durationMs);
  logger.info('Round ended', { roundId });
  return updated;
}

export async function pauseRound(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  assertRoundTransition(round.status, 'PAUSED');

  // Capture remaining time from in-memory timer BEFORE pausing
  timerService.pauseRoundTimer(roundId);
  const pausedTimer = timerService.getRoundTimer(roundId);
  const remainingMs = pausedTimer?.remainingMs ?? Math.max(0, (round.startedAt ? round.startedAt.getTime() + round.durationMs - Date.now() : 0));

  const updated = await prisma.round.update({
    where: { id: roundId },
    data: { status: 'PAUSED', pausedRemainingMs: Math.round(remainingMs) },
  });

  socketService.emitRoundStateChange(roundId, 'PAUSED', round.startedAt, round.durationMs, remainingMs);
  logger.info('Round paused', { roundId, remainingMs });
  return updated;
}

export async function resumeRound(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  assertRoundTransition(round.status, 'ACTIVE');

  // If no in-memory timer (e.g. server restarted while paused), reconstruct it as a paused timer
  // so resumeRoundTimer can pick up the correct remaining time
  if (!timerService.getRoundTimer(roundId) && round.pausedRemainingMs != null && round.startedAt) {
    const fakeEndAt = new Date(round.startedAt.getTime() + round.durationMs);
    timerService.startRoundTimer(roundId, round.durationMs, round.startedAt, fakeEndAt);
    timerService.pauseRoundTimer(roundId);
    // Override the remainingWhenPaused to the DB value
    timerService.overridePausedRemaining(roundId, round.pausedRemainingMs);
  }

  timerService.resumeRoundTimer(roundId);
  const resumedTimer = timerService.getRoundTimer(roundId);
  const remainingMs = resumedTimer?.remainingMs ?? (round.pausedRemainingMs ?? round.durationMs);

  const updated = await prisma.round.update({
    where: { id: roundId },
    data: { status: 'ACTIVE', pausedRemainingMs: null },
  });

  socketService.emitRoundStateChange(roundId, 'ACTIVE', round.startedAt, round.durationMs, remainingMs);
  logger.info('Round resumed', { roundId, remainingMs });
  return updated;
}

export async function setActiveActivity(roundId: string, activityId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  const activity = await prisma.activity.findFirst({
    where: { id: activityId, roundId },
  });
  if (!activity) throw createError('Activity not found in this round', 404);

  // Deactivate all activities in round, activate selected
  await prisma.activity.updateMany({ where: { roundId }, data: { isActive: false } });
  await prisma.activity.update({ where: { id: activityId }, data: { isActive: true } });
  await prisma.round.update({ where: { id: roundId }, data: { activeActivityId: activityId } });

  socketService.emitActivityChange(roundId, activityId);
  logger.info('Active activity changed', { roundId, activityId });
}

export async function getRoundStatus(roundId: string) {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round) throw createError('Round not found', 404);

  const timerState = timerService.getRoundTimer(roundId);

  return {
    ...round,
    remainingMs: timerState?.remainingMs ?? null,
    serverTime: Date.now(),
  };
}

export async function isRoundActive(roundId: string): Promise<boolean> {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    select: { status: true },
  });
  return round?.status === 'ACTIVE';
}

/**
 * Auto-start Round 1 when first participant connects.
 * Called by the GET /competition route when role is PARTICIPANT and round is UPCOMING.
 */
export async function autoStartRound1IfNeeded(): Promise<void> {
  const competition = await prisma.competition.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { rounds: { where: { roundNumber: 1 }, take: 1 } },
  });
  if (!competition) return;

  const round1 = competition.rounds[0];
  if (!round1 || round1.status !== 'UPCOMING') return;

  // Auto-start: move competition to RUNNING and round to ACTIVE
  const now = new Date();
  const endAt = new Date(now.getTime() + round1.durationMs);

  await prisma.round.update({
    where: { id: round1.id },
    data: { status: 'ACTIVE', startedAt: now },
  });
  await prisma.competition.update({
    where: { id: competition.id },
    data: { status: 'RUNNING', currentRoundId: round1.id },
  });

  timerService.startRoundTimer(round1.id, round1.durationMs, now, endAt);
  socketService.emitRoundStateChange(round1.id, 'ACTIVE', now, round1.durationMs);
  logger.info('Round 1 auto-started on first participant join', { roundId: round1.id });
}

/**
 * Reset entire competition back to initial state for testing.
 * Clears all submissions, scores, audit events, participant sessions.
 * Resets competition and round statuses. Stops all timers.
 */
export async function resetCompetition(): Promise<void> {
  const competition = await prisma.competition.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  });
  if (!competition) throw createError('No competition found', 404);

  // Stop all running timers
  for (const round of competition.rounds) {
    timerService.stopRoundTimer(round.id);
  }

  // Clear all transient data
  await prisma.leaderboardEntry.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.auditEvent.deleteMany({});
  await prisma.participantSession.deleteMany({});
  await prisma.participantActivitySession.deleteMany({});


  // Reset all rounds to UPCOMING
  for (const round of competition.rounds) {
    await prisma.round.update({
      where: { id: round.id },
      data: { status: 'UPCOMING', startedAt: null, endedAt: null },
    });
  }

  // Reset active activity for each round separately
  for (const round of competition.rounds) {
    const activities = await prisma.activity.findMany({
      where: { roundId: round.id },
      orderBy: { createdAt: 'asc' },
    });

    if (activities.length === 0) continue;

    // For Round 1: activate first activity (DUMB_CHARADES)
    // For Round 2: activate CODE_DEBUGGING activity if it exists
    let targetActivity = activities[0];
    if (round.roundNumber === 2) {
      const debugActivity = activities.find(a => a.type === 'CODE_DEBUGGING');
      if (debugActivity) targetActivity = debugActivity;
    }

    await prisma.activity.updateMany({ where: { roundId: round.id }, data: { isActive: false } });
    await prisma.activity.update({ where: { id: targetActivity.id }, data: { isActive: true } });
    await prisma.round.update({ where: { id: round.id }, data: { activeActivityId: targetActivity.id } });
  }

  // Reset competition state
  await prisma.competition.update({
    where: { id: competition.id },
    data: { status: 'NOT_STARTED', currentRoundId: null },
  });

  // Notify all connected clients
  socketService.emitCompetitionStateChange('NOT_STARTED', null);
  logger.info('Competition reset by admin', { competitionId: competition.id });
}
