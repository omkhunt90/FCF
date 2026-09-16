import { prisma } from '../../db/prisma';
import { hashPassword } from '../auth/auth.service';
import { createError } from '../../middleware/error.middleware';
import { logger } from '../../config/logger';
import { getRankedLeaderboard } from '../submissions/submission.service';
import { socketService } from '../../services/socket.service';

export interface CreateParticipantInput {
  username: string;
  password: string;
  displayName: string;
  teamName?: string;
}

export async function createParticipant(input: CreateParticipantInput) {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) throw createError('Username already exists', 409);

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      username: input.username,
      passwordHash,
      role: 'PARTICIPANT',
      participant: {
        create: {
          displayName: input.displayName,
          teamName: input.teamName,
          leaderboardEntry: { create: {} },
        },
      },
    },
    include: { participant: true },
  });

  logger.info('Participant created', { userId: user.id, username: user.username });
  return { id: user.id, username: user.username, participant: user.participant };
}

export async function listParticipants() {
  return prisma.participant.findMany({
    select: {
      id: true,
      displayName: true,
      teamName: true,
      isActive: true,
      assignedQuestionBank: true,
      user: { select: { id: true, username: true, isActive: true } },
      leaderboardEntry: true,
      _count: { select: { submissions: true, auditEvents: true } },
    },
    orderBy: { displayName: 'asc' },
  });
}

export async function getParticipant(participantId: string) {
  const p = await prisma.participant.findUnique({
    where: { id: participantId },
    include: {
      user: { select: { id: true, username: true, isActive: true } },
      leaderboardEntry: true,
      sessions: { orderBy: { lastSeenAt: 'desc' }, take: 1 },
      _count: { select: { submissions: true, auditEvents: true } },
    },
  });
  if (!p) throw createError('Participant not found', 404);
  return p;
}

export async function disableParticipant(participantId: string) {
  const p = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!p) throw createError('Participant not found', 404);

  await prisma.participant.update({ where: { id: participantId }, data: { isActive: false } });
  await prisma.user.update({ where: { id: p.userId }, data: { isActive: false } });
  logger.info('Participant disabled', { participantId });
}

export async function enableParticipant(participantId: string) {
  const p = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!p) throw createError('Participant not found', 404);

  await prisma.participant.update({ where: { id: participantId }, data: { isActive: true } });
  await prisma.user.update({ where: { id: p.userId }, data: { isActive: true } });
  logger.info('Participant enabled', { participantId });
}

export async function getParticipantAuditEvents(participantId: string) {
  return prisma.auditEvent.findMany({
    where: { participantId },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  });
}

/**
 * Admin assigns a Dumb Charades question bank (1, 2, or 3) to a participant.
 * Pass null to clear the assignment.
 */
export async function setQuestionBank(participantId: string, bank: number | null) {
  if (bank !== null && (bank < 1 || bank > 3 || !Number.isInteger(bank))) {
    throw createError('Question bank must be 1, 2, or 3', 400);
  }
  const p = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!p) throw createError('Participant not found', 404);

  return prisma.participant.update({
    where: { id: participantId },
    data: { assignedQuestionBank: bank },
    select: { id: true, displayName: true, teamName: true, assignedQuestionBank: true },
  });
}

export async function deleteParticipant(participantId: string) {
  const p = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!p) throw createError('Participant not found', 404);

  await prisma.$transaction([
    prisma.submission.deleteMany({ where: { participantId } }),
    prisma.auditEvent.deleteMany({ where: { participantId } }),
    prisma.leaderboardEntry.deleteMany({ where: { participantId } }),
    prisma.participantActivitySession.deleteMany({ where: { participantId } }),
    prisma.participantSession.deleteMany({ where: { participantId } }),
    prisma.participant.delete({ where: { id: participantId } }),
    prisma.user.delete({ where: { id: p.userId } }),
  ]);

  logger.info('Participant deleted', { participantId, userId: p.userId });

  // Update live leaderboard
  const updatedEntries = await getRankedLeaderboard();
  socketService.emitLeaderboardUpdate(updatedEntries);
}
