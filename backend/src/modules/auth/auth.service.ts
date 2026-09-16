import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma';
import { config } from '../../config/env';
import { AuthTokenPayload } from '../../types';
import { createError } from '../../middleware/error.middleware';
import { logger } from '../../config/logger';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function generateRefreshToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): AuthTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as AuthTokenPayload;
}

export async function login(
  username: string,
  password: string
): Promise<{ accessToken: string; refreshToken: string; user: { id: string; username: string; role: string; participantId?: string; displayName?: string } }> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { participant: true },
  });

  if (!user || !user.isActive) {
    throw createError('Invalid credentials', 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    logger.warn('Failed login attempt', { username });
    throw createError('Invalid credentials', 401);
  }

  if (user.role === 'PARTICIPANT' && (!user.participant || !user.participant.isActive)) {
    throw createError('Account is disabled', 403);
  }

  const payload: AuthTokenPayload = {
    userId: user.id,
    role: user.role,
    ...(user.participant ? { participantId: user.participant.id } : {}),
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  logger.info('User logged in', { userId: user.id, role: user.role });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      ...(user.participant
        ? {
            participantId: user.participant.id,
            displayName: user.participant.displayName,
          }
        : {}),
    },
  };
}

export async function refresh(
  token: string
): Promise<{ accessToken: string }> {
  // Check if token is blacklisted
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    throw createError('Token has been revoked', 401);
  }

  let payload: AuthTokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw createError('Invalid or expired refresh token', 401);
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { participant: true },
  });

  if (!user || !user.isActive) {
    throw createError('User not found or inactive', 401);
  }

  const newPayload: AuthTokenPayload = {
    userId: user.id,
    role: user.role,
    ...(user.participant ? { participantId: user.participant.id } : {}),
  };

  return { accessToken: generateAccessToken(newPayload) };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError('User not found', 404);

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw createError('Current password is incorrect', 401);
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  logger.info('Password changed', { userId });
}

export async function blacklistRefreshToken(token: string): Promise<void> {
  try {
    const decoded = jwt.decode(token) as AuthTokenPayload & { exp?: number; iat?: number } | null;
    if (!decoded) return;

    const expiresAt = new Date(decoded.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.tokenBlacklist.upsert({
      where: { token },
      update: {},
      create: {
        token,
        userId: decoded.userId,
        expiresAt,
      },
    });
    logger.info('Token blacklisted', { userId: decoded.userId });
  } catch {
    // Token already expired or invalid — no need to blacklist
  }
}

export function isTokenBlacklisted(token: string): Promise<boolean> {
  return prisma.tokenBlacklist
    .findUnique({ where: { token }, select: { id: true } })
    .then((record) => !!record);
}
