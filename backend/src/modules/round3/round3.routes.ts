import { Router, Request, Response, NextFunction } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware";
import { timerService } from "../../services/timer.service";
import { socketService } from "../../services/socket.service";
import { prisma } from "../../db/prisma";
import { createError } from "../../middleware/error.middleware";
import { logger } from "../../config/logger";

const router = Router();

const FREEZE_DURATION_MS = 3 * 60 * 1000;
const TIME_WARP_MS       = -4 * 60 * 1000;
const TURBO_BOOST_MS     = 4 * 60 * 1000;

async function getRound3ActiveRound() {
  return prisma.round.findFirst({
    where: { roundNumber: 3, status: "ACTIVE" },
    select: { id: true },
  });
}

router.post("/power/:participantId/freeze", authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { participantId } = req.params;
      const participant = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, displayName: true },
      });
      if (!participant) throw createError("Participant not found", 404);
      const round3 = await getRound3ActiveRound();
      if (!round3) throw createError("Round 3 is not currently active", 400);
      const freezeEndMs = timerService.setParticipantFreeze(participantId, FREEZE_DURATION_MS);
      socketService.emitRound3Power(participantId, "freeze", {
        message: "Keyboard Freeze! Your keyboard has been frozen for 3 minutes.",
        durationMs: FREEZE_DURATION_MS,
        freezeEndMs,
      });
      logger.info("Admin applied keyboard freeze", { participantId });
      res.json({ success: true, message: `Keyboard freeze applied to ${participant.displayName}`, freezeEndMs });
    } catch (e) { next(e); }
  }
);

router.post("/power/:participantId/time-warp", authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { participantId } = req.params;
      const participant = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, displayName: true },
      });
      if (!participant) throw createError("Participant not found", 404);
      const round3 = await getRound3ActiveRound();
      if (!round3) throw createError("Round 3 is not currently active", 400);
      timerService.adjustParticipantTimer(participantId, round3.id, TIME_WARP_MS);
      const newRemaining = timerService.getParticipantRemainingMs(participantId, round3.id) ?? 0;
      const totalOffset = timerService.getParticipantOffset(participantId, round3.id);
      socketService.emitRound3Power(participantId, "time_warp", {
        message: "Time Warp! 4 minutes have been deducted from your timer.",
        deltaMs: TIME_WARP_MS,
        timerOffsetMs: totalOffset,
        newRemainingMs: newRemaining,
      });
      res.json({ success: true, message: `Time Warp applied to ${participant.displayName}`, newRemainingMs: newRemaining, timerOffsetMs: totalOffset });
    } catch (e) { next(e); }
  }
);

router.post("/power/:participantId/turbo-boost", authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { participantId } = req.params;
      const participant = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, displayName: true },
      });
      if (!participant) throw createError("Participant not found", 404);
      const round3 = await getRound3ActiveRound();
      if (!round3) throw createError("Round 3 is not currently active", 400);
      timerService.adjustParticipantTimer(participantId, round3.id, TURBO_BOOST_MS);
      const newRemaining = timerService.getParticipantRemainingMs(participantId, round3.id) ?? 0;
      const totalOffset = timerService.getParticipantOffset(participantId, round3.id);
      socketService.emitRound3Power(participantId, "turbo_boost", {
        message: "Turbo Boost! 4 minutes have been added to your timer.",
        deltaMs: TURBO_BOOST_MS,
        timerOffsetMs: totalOffset,
        newRemainingMs: newRemaining,
      });
      res.json({ success: true, message: `Turbo Boost applied to ${participant.displayName}`, newRemainingMs: newRemaining, timerOffsetMs: totalOffset });
    } catch (e) { next(e); }
  }
);

router.get("/participants", authenticate, requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const round3 = await prisma.round.findFirst({
        where: { roundNumber: 3 },
        select: { id: true, status: true },
      });
      const participants = await prisma.participant.findMany({
        where: { isActive: true },
        select: { id: true, displayName: true, teamName: true },
        orderBy: { displayName: "asc" },
      });
      const data = participants.map(p => {
        const timerOffset = round3 ? timerService.getParticipantOffset(p.id, round3.id) : 0;
        const personalRemaining = round3 ? timerService.getParticipantRemainingMs(p.id, round3.id) : null;
        const freezeStatus = timerService.getParticipantFreezeStatus(p.id);
        return { ...p, timerOffsetMs: timerOffset, personalRemainingMs: personalRemaining, isFrozen: freezeStatus.isFrozen, freezeRemainingMs: freezeStatus.remainingMs, freezeEndMs: freezeStatus.freezeEndMs };
      });
      res.json({ success: true, data, round3Status: round3?.status ?? "NOT_SETUP" });
    } catch (e) { next(e); }
  }
);

// GET /api/v1/round3/my-status — participant polls their own freeze + timer state on refresh
router.get("/my-status", authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.user?.participantId;
      if (!participantId) { res.status(403).json({ success: false, message: 'Participants only' }); return; }

      const round3 = await prisma.round.findFirst({
        where: { roundNumber: 3 },
        select: { id: true, status: true },
      });

      const offset = round3 ? timerService.getParticipantOffset(participantId, round3.id) : 0;
      const personalRemaining = (round3 && offset !== 0)
        ? timerService.getParticipantRemainingMs(participantId, round3.id)
        : null;
      const freezeStatus = timerService.getParticipantFreezeStatus(participantId);

      res.json({
        success: true,
        data: {
          timerOffsetMs: offset,
          personalRemainingMs: personalRemaining,
          isFrozen: freezeStatus.isFrozen,
          freezeRemainingMs: freezeStatus.remainingMs,
          freezeEndMs: freezeStatus.freezeEndMs,
          round3Active: round3?.status === 'ACTIVE',
        },
      });
    } catch (e) { next(e); }
  }
);

export default router;

