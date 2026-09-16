import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Competition, Round, TimerSyncEvent, RoundStateEvent, LeaderboardEntry, Round3PowerEvent } from '../types';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

interface CompetitionContextValue {
  competition: Competition | null;
  currentRound: Round | null;
  remainingMs: number | null;
  isLoading: boolean;
  isPaused: boolean;
  refreshCompetition: () => Promise<void>;
  socket: Socket | null;
  leaderboard: LeaderboardEntry[];
  round3Power: Round3PowerEvent | null;
  clearRound3Power: () => void;
}

const CompetitionContext = createContext<CompetitionContextValue | null>(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

export function CompetitionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [round3Power, setRound3Power] = useState<Round3PowerEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const competitionRef = useRef<Competition | null>(null);
  competitionRef.current = competition;
  // Local timer — ticks down between server syncs
  const localTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCompetition = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    try {
      const res = await api.getCompetition();
      if (res.success && res.data) {
        const comp = res.data as Competition;
        setCompetition(comp);
        // Initialize remaining time from timer info if available and matches current round
        if (res.data.timerInfo?.remainingMs != null) {
          if (!comp.currentRoundId || res.data.timerInfo.id === comp.currentRoundId) {
            setRemainingMs(res.data.timerInfo.remainingMs);
          }
        }
      }
    } catch {
      // Competition not configured yet
    }
  }, []);

  // Connect socket and fetch competition when authenticated
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setCompetition(null);
      setIsLoading(false);
      return;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setIsLoading(false);
      return;
    }

    void refreshCompetition().finally(() => setIsLoading(false));

    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('competition:state_change', (data: { status: string; currentRoundId: string | null }) => {
      setCompetition((prev) => prev ? { ...prev, status: data.status as Competition['status'], currentRoundId: data.currentRoundId } : prev);
      void refreshCompetition();
    });

    socket.on('round:state_change', (data: RoundStateEvent) => {
      setCompetition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rounds: prev.rounds.map((r) =>
            r.id === data.roundId ? { ...r, status: data.status, startedAt: data.startedAt } : r
          ),
        };
      });
      // Only set timer if this event is for the current round
      if (!competitionRef.current?.currentRoundId || data.roundId === competitionRef.current.currentRoundId) {
        if (data.status === 'PAUSED') {
          if (data.remainingMs != null) setRemainingMs(data.remainingMs);
        } else if (data.status === 'ACTIVE') {
          setRemainingMs(data.remainingMs ?? data.durationMs);
        } else if (data.status === 'ENDED') {
          setRemainingMs(0);
        }
      }
      void refreshCompetition();
    });

    socket.on('round:activity_change', (data: { roundId: string; activityId: string }) => {
      setCompetition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rounds: prev.rounds.map((r) =>
            r.id === data.roundId ? { ...r, activeActivityId: data.activityId } : r
          ),
        };
      });
    });

    // Server timer sync — ignore if from a different round
    socket.on('timer:sync', (data: TimerSyncEvent) => {
      if (competitionRef.current?.currentRoundId && data.roundId !== competitionRef.current.currentRoundId) {
        return; // Ignore timer sync from other/stale rounds
      }
      const clientLatency = (Date.now() - data.serverTs) / 2;
      const adjusted = Math.max(0, data.remainingMs - clientLatency);
      setRemainingMs(adjusted);
    });

    // Round expired — server ended it
    socket.on('round:expired', (data?: { roundId?: string }) => {
      if (data?.roundId && competitionRef.current?.currentRoundId && data.roundId !== competitionRef.current.currentRoundId) {
        return;
      }
      setRemainingMs(0);
    });

    // Real-time leaderboard updates
    socket.on('leaderboard:update', (data: { entries: LeaderboardEntry[]; updatedAt: number }) => {
      setLeaderboard(data.entries);
    });

    // Round 3 admin power events (participant receives these)
    socket.on('round3:power', (data: Round3PowerEvent) => {
      setRound3Power(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, refreshCompetition]);

  const currentRound = competition?.rounds.find((r) => r.id === competition.currentRoundId) ?? null;
  const isPaused = currentRound?.status === 'PAUSED';

  // Local tick to keep countdown smooth between server syncs (freezes completely when paused)
  useEffect(() => {
    if (localTimerRef.current) {
      clearInterval(localTimerRef.current);
      localTimerRef.current = null;
    }
    if (isPaused) return;

    localTimerRef.current = setInterval(() => {
      setRemainingMs((prev) => {
        if (prev == null || prev <= 0) return 0;
        return Math.max(0, prev - 1000);
      });
    }, 1000);

    return () => {
      if (localTimerRef.current) {
        clearInterval(localTimerRef.current);
        localTimerRef.current = null;
      }
    };
  }, [isPaused]);

  return (
    <CompetitionContext.Provider value={{
      competition,
      currentRound,
      remainingMs,
      isLoading,
      isPaused,
      refreshCompetition,
      socket: socketRef.current,
      leaderboard,
      round3Power,
      clearRound3Power: () => setRound3Power(null),
    }}>
      {children}
    </CompetitionContext.Provider>
  );
}

export function useCompetition(): CompetitionContextValue {
  const ctx = useContext(CompetitionContext);
  if (!ctx) throw new Error('useCompetition must be used inside CompetitionProvider');
  return ctx;
}
