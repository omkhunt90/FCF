import { EventEmitter } from 'events';
import { logger } from '../config/logger';

interface RoundTimer {
  roundId: string;
  durationMs: number;
  startedAt: Date;
  endAt: Date;
  remainingMs: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  isPaused: boolean;
  pausedAt: Date | null;
  remainingWhenPaused: number | null;
}

class TimerService extends EventEmitter {
  private timers: Map<string, RoundTimer> = new Map();

  // Per-participant timer offsets for Round 3 (roundId -> participantId -> offsetMs)
  // Positive = time added (Turbo Boost), negative = time removed (Time Warp)
  private participantOffsets: Map<string, Map<string, number>> = new Map();

  // Per-participant keyboard freeze end times (participantId -> freezeEndMs epoch)
  private participantFreezeEnds: Map<string, number> = new Map();

  startRoundTimer(
    roundId: string,
    durationMs: number,
    startedAt: Date,
    endAt: Date
  ): void {
    this.stopAllRoundTimers(); // clear all existing timers so only 1 round timer ever ticks

    const timer: RoundTimer = {
      roundId,
      durationMs,
      startedAt,
      endAt,
      remainingMs: durationMs,
      intervalHandle: null,
      timeoutHandle: null,
      isPaused: false,
      pausedAt: null,
      remainingWhenPaused: null,
    };

    // Sync timer every 10 seconds via WebSocket (efficient)
    timer.intervalHandle = setInterval(() => {
      const remaining = Math.max(0, endAt.getTime() - Date.now());
      timer.remainingMs = remaining;
      this.emit('timer:sync', { roundId, remainingMs: remaining, serverTs: Date.now() });
    }, 10_000);

    // Exact timeout for round expiry
    const msUntilEnd = endAt.getTime() - Date.now();
    timer.timeoutHandle = setTimeout(() => {
      logger.info('Round timer expired', { roundId });
      this.emit('timer:expired', { roundId });
      this.stopRoundTimer(roundId);
    }, msUntilEnd);

    this.timers.set(roundId, timer);
    logger.info('Round timer started', { roundId, durationMs, endAt });
    // Emit immediate sync on start so clients don't wait 10s for first interval
    this.emit('timer:sync', { roundId, remainingMs: durationMs, serverTs: Date.now() });
  }

  stopRoundTimer(roundId: string): void {
    const timer = this.timers.get(roundId);
    if (!timer) return;

    if (timer.intervalHandle) clearInterval(timer.intervalHandle);
    if (timer.timeoutHandle) clearTimeout(timer.timeoutHandle);
    this.timers.delete(roundId);
    // Clear all participant offsets for this round
    this.participantOffsets.delete(roundId);
    logger.info('Round timer stopped', { roundId });
  }

  stopAllRoundTimers(): void {
    for (const roundId of Array.from(this.timers.keys())) {
      this.stopRoundTimer(roundId);
    }
  }

  pauseRoundTimer(roundId: string): void {
    const timer = this.timers.get(roundId);
    if (!timer || timer.isPaused) return;

    if (timer.intervalHandle) clearInterval(timer.intervalHandle);
    if (timer.timeoutHandle) clearTimeout(timer.timeoutHandle);

    timer.isPaused = true;
    timer.pausedAt = new Date();
    timer.remainingWhenPaused = Math.max(0, timer.endAt.getTime() - Date.now());
    timer.remainingMs = timer.remainingWhenPaused;

    // Immediately sync frozen timer to all clients
    this.emit('timer:sync', { roundId, remainingMs: timer.remainingMs, serverTs: Date.now() });
    logger.info('Round timer paused', { roundId, remainingMs: timer.remainingWhenPaused });
  }

  resumeRoundTimer(roundId: string): void {
    const timer = this.timers.get(roundId);
    if (!timer || !timer.isPaused || timer.remainingWhenPaused == null) return;

    // Keep frozen remaining time intact — do NOT deduct paused time
    const newRemaining = timer.remainingWhenPaused;
    const newEndAt = new Date(Date.now() + newRemaining);

    timer.endAt = newEndAt;
    timer.isPaused = false;
    timer.pausedAt = null;
    timer.remainingWhenPaused = null;
    timer.remainingMs = newRemaining;

    // Immediately sync resumed timer to all clients
    this.emit('timer:sync', { roundId, remainingMs: newRemaining, serverTs: Date.now() });

    // Restart sync interval
    timer.intervalHandle = setInterval(() => {
      const remaining = Math.max(0, timer.endAt.getTime() - Date.now());
      timer.remainingMs = remaining;
      this.emit('timer:sync', { roundId, remainingMs: remaining, serverTs: Date.now() });
    }, 10_000);

    // Restart timeout
    timer.timeoutHandle = setTimeout(() => {
      logger.info('Round timer expired', { roundId });
      this.emit('timer:expired', { roundId });
      this.stopRoundTimer(roundId);
    }, newRemaining);

    logger.info('Round timer resumed', { roundId, remainingMs: newRemaining });
  }

  /**
   * Override the remainingWhenPaused of a paused timer.
   * Used when reconstructing a timer from DB after server restart.
   */
  overridePausedRemaining(roundId: string, remainingMs: number): void {
    const timer = this.timers.get(roundId);
    if (!timer || !timer.isPaused) return;
    timer.remainingWhenPaused = remainingMs;
    timer.remainingMs = remainingMs;
  }

  getRoundTimer(roundId: string): { remainingMs: number; endAt: Date; isPaused: boolean } | null {
    const timer = this.timers.get(roundId);
    if (!timer) return null;
    const remainingMs = timer.isPaused && timer.remainingWhenPaused != null
      ? timer.remainingWhenPaused
      : Math.max(0, timer.endAt.getTime() - Date.now());
    return {
      remainingMs,
      endAt: timer.endAt,
      isPaused: timer.isPaused,
    };
  }

  // Restore timers after server restart (called with DB data)
  restoreTimer(roundId: string, durationMs: number, startedAt: Date): void {
    const endAt = new Date(startedAt.getTime() + durationMs);
    if (endAt > new Date()) {
      this.startRoundTimer(roundId, durationMs, startedAt, endAt);
      logger.info('Timer restored after restart', { roundId });
    } else {
      logger.warn('Timer already expired, not restoring', { roundId });
      this.emit('timer:expired', { roundId });
    }
  }

  // ── Per-participant timer offsets (Round 3 powers) ──────────────────────────

  /**
   * Adjust a participant's personal remaining time by deltaMs.
   * Positive = add time (Turbo Boost), Negative = remove time (Time Warp).
   */
  adjustParticipantTimer(participantId: string, roundId: string, deltaMs: number): void {
    if (!this.participantOffsets.has(roundId)) {
      this.participantOffsets.set(roundId, new Map());
    }
    const offsets = this.participantOffsets.get(roundId)!;
    const current = offsets.get(participantId) ?? 0;
    offsets.set(participantId, current + deltaMs);
    logger.info('Participant timer adjusted', { participantId, roundId, deltaMs, total: current + deltaMs });
  }

  /**
   * Get the participant's personal remaining time for Round 3.
   * = base remaining + personal offset (clamped to 0)
   */
  getParticipantRemainingMs(participantId: string, roundId: string): number | null {
    const base = this.getRoundTimer(roundId);
    if (!base) return null;
    const offsets = this.participantOffsets.get(roundId);
    const offset = offsets?.get(participantId) ?? 0;
    return Math.max(0, base.remainingMs + offset);
  }

  getParticipantOffset(participantId: string, roundId: string): number {
    return this.participantOffsets.get(roundId)?.get(participantId) ?? 0;
  }

  // ── Per-participant keyboard freeze ──────────────────────────────────────────

  /**
   * Freeze a participant's keyboard for durationMs starting now.
   */
  setParticipantFreeze(participantId: string, durationMs: number): number {
    const freezeEndMs = Date.now() + durationMs;
    this.participantFreezeEnds.set(participantId, freezeEndMs);
    logger.info('Participant keyboard frozen', { participantId, durationMs });
    return freezeEndMs;
  }

  getParticipantFreezeStatus(participantId: string): { isFrozen: boolean; remainingMs: number; freezeEndMs: number | null } {
    const freezeEnd = this.participantFreezeEnds.get(participantId);
    if (!freezeEnd) return { isFrozen: false, remainingMs: 0, freezeEndMs: null };
    const remaining = freezeEnd - Date.now();
    if (remaining <= 0) {
      this.participantFreezeEnds.delete(participantId);
      return { isFrozen: false, remainingMs: 0, freezeEndMs: null };
    }
    return { isFrozen: true, remainingMs: remaining, freezeEndMs: freezeEnd };
  }

  isParticipantFrozen(participantId: string): boolean {
    return this.getParticipantFreezeStatus(participantId).isFrozen;
  }
}

export const timerService = new TimerService();
