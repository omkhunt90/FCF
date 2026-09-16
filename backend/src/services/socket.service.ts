import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { AuthTokenPayload } from '../types';
import { timerService } from './timer.service';
import { logger } from '../config/logger';
import { prisma } from '../db/prisma';

class SocketService {
  private io: SocketServer | null = null;

  initialize(httpServer: HttpServer): void {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: config.FRONTEND_URL,
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    // Auth middleware for Socket.IO
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token as string;
      if (!token) return next(new Error('Authentication required'));

      try {
        const payload = jwt.verify(token, config.JWT_SECRET) as AuthTokenPayload;
        (socket as unknown as { user: AuthTokenPayload }).user = payload;
        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = (socket as unknown as { user: AuthTokenPayload }).user;
      logger.info('Socket connected', { userId: user.userId, role: user.role });

      // Join role-specific room
      void socket.join(`role:${user.role}`);

      if (user.role === 'PARTICIPANT' && user.participantId) {
        void socket.join(`participant:${user.participantId}`);
      }

      // Participant audit event reporting
      socket.on('audit:event', async (data: { eventType: string; metadata?: object }) => {
        if (user.role !== 'PARTICIPANT' || !user.participantId) return;
        try {
          await prisma.auditEvent.create({
            data: {
              participantId: user.participantId,
              eventType: data.eventType as never,
              metadata: data.metadata ?? {},
            },
          });
          // Notify admin room
          this.io?.to('role:ADMIN').emit('audit:flagged', {
            participantId: user.participantId,
            eventType: data.eventType,
            occurredAt: new Date(),
          });
        } catch (err) {
          logger.error('Failed to save audit event', { err });
        }
      });

      socket.on('participant:heartbeat', () => {
        if (user.participantId) {
          void prisma.participantSession.updateMany({
            where: { participantId: user.participantId },
            data: { lastSeenAt: new Date() },
          });
        }
      });

      socket.on('disconnect', () => {
        logger.info('Socket disconnected', { userId: user.userId });
      });
    });

    // Wire timer events to socket emissions
    timerService.on('timer:sync', (data: { roundId: string; remainingMs: number; serverTs: number }) => {
      this.io?.emit('timer:sync', data);
    });

    timerService.on('timer:expired', (data: { roundId: string }) => {
      this.io?.emit('round:expired', data);
    });

    logger.info('Socket.IO initialized');
  }

  emitCompetitionStateChange(status: string, currentRoundId: string | null): void {
    this.io?.emit('competition:state_change', { status, currentRoundId });
  }

  emitRoundStateChange(roundId: string, status: string, startedAt: Date | null, durationMs: number, remainingMs?: number): void {
    this.io?.emit('round:state_change', { roundId, status, startedAt, durationMs, remainingMs });
  }

  emitActivityChange(roundId: string, activityId: string): void {
    this.io?.emit('round:activity_change', { roundId, activityId });
  }

  emitSubmissionResult(participantId: string, result: object): void {
    this.io?.to(`participant:${participantId}`).emit('submission:result', result);
  }

  emitAdminAnnouncement(message: string, severity: 'info' | 'warning' | 'error'): void {
    this.io?.emit('admin:announcement', { message, severity, timestamp: Date.now() });
  }

  emitLeaderboardUpdate(entries: object[]): void {
    this.io?.emit('leaderboard:update', { entries, updatedAt: Date.now() });
  }

  /**
   * Emit a Round 3 power event to a specific participant.
   * power: 'freeze' | 'time_warp' | 'turbo_boost'
   */
  emitRound3Power(participantId: string, power: string, payload: object): void {
    this.io?.to(`participant:${participantId}`).emit('round3:power', { power, ...payload, timestamp: Date.now() });
  }

  /**
   * Emit a per-participant adjusted timer sync to a specific participant.
   */
  emitRound3TimerSync(participantId: string, roundId: string, remainingMs: number): void {
    this.io?.to(`participant:${participantId}`).emit('round3:timer_sync', { roundId, remainingMs, serverTs: Date.now() });
  }

  getIO(): SocketServer | null {
    return this.io;
  }
}

export const socketService = new SocketService();
