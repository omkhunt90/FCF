import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/env';
import { logger } from './config/logger';
import { connectDB, prisma } from './db/prisma';
import { socketService } from './services/socket.service';
import { timerService } from './services/timer.service';
import { errorHandler, notFound } from './middleware/error.middleware';

// Routes
import authRoutes from './modules/auth/auth.routes';
import participantRoutes from './modules/participants/participant.routes';
import taskRoutes from './modules/tasks/task.routes';
import submissionRoutes from './modules/submissions/submission.routes';
import competitionRoutes from './modules/competition/competition.routes';
import leaderboardRoutes from './modules/leaderboard/leaderboard.routes';
import adminRoutes from './modules/admin/admin.routes';
import activitySessionRoutes from './modules/activity-sessions/activity-session.routes';
import round3Routes from './modules/round3/round3.routes';

const app = express();
const httpServer = createServer(app);

// ------- Security & middleware -------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", config.FRONTEND_URL],
    },
  },
}));

app.use(cors({
  origin: config.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(compression());
app.use(express.json({ limit: '1mb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ------- Rate limiting -------
const globalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.NODE_ENV === 'development' ? 5000 : config.RATE_LIMIT_MAX_REQUESTS,
  skip: () => config.NODE_ENV === 'development',
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const compilerLimiter = rateLimit({
  windowMs: 60_000,
  max: config.NODE_ENV === 'development' ? 5000 : config.COMPILER_RATE_LIMIT_MAX,
  skip: () => config.NODE_ENV === 'development',
  message: { success: false, message: 'Compiler rate limit exceeded.' },
});

app.use('/api', globalLimiter);
app.use('/api/v1/submissions', compilerLimiter);

// ------- Routes -------
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/participants', participantRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/submissions', submissionRoutes);
app.use('/api/v1/competition', competitionRoutes);
app.use('/api/v1/activity-sessions', activitySessionRoutes);
app.use('/api/v1/leaderboard', leaderboardRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/round3', round3Routes);


// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ------- Error handlers -------
app.use(notFound);
app.use(errorHandler);

// ------- Socket.IO -------
socketService.initialize(httpServer);

// ------- Startup -------
async function start(): Promise<void> {
  await connectDB();

  // Restore active and paused round timers after server restart
  try {
    const liveRounds = await prisma.round.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] } },
    });
    let activeCount = 0;
    let pausedCount = 0;
    for (const round of liveRounds) {
      if (!round.startedAt) continue;
      if (round.status === 'ACTIVE') {
        timerService.restoreTimer(round.id, round.durationMs, round.startedAt);
        activeCount++;
      } else if (round.status === 'PAUSED' && round.pausedRemainingMs != null) {
        // Reconstruct as a paused timer using the stored remaining time
        const fakeEndAt = new Date(round.startedAt.getTime() + round.durationMs);
        timerService.startRoundTimer(round.id, round.durationMs, round.startedAt, fakeEndAt);
        timerService.pauseRoundTimer(round.id);
        timerService.overridePausedRemaining(round.id, round.pausedRemainingMs);
        pausedCount++;
      }
    }
    if (activeCount + pausedCount > 0) {
      logger.info('Restored round timers', { active: activeCount, paused: pausedCount });
    }
  } catch (err) {
    logger.error('Failed to restore timers', { err });
  }

  // Handle timer expiry — end round automatically
  timerService.on('timer:expired', async (data: { roundId: string }) => {
    try {
      const { endRound } = await import('./modules/competition/competition.service');
      await endRound(data.roundId);
      logger.info('Round auto-ended by timer', { roundId: data.roundId });
    } catch (err) {
      logger.error('Failed to auto-end round', { err, roundId: data.roundId });
    }
  });

  httpServer.listen(config.PORT, () => {
    logger.info(`FCF Backend running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down');
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
});

start().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});
