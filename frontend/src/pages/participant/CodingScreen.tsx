import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useTheme } from '../../context/ThemeContext';
import { useCompetition } from '../../context/CompetitionContext';
import type { AuditEventPayload, TestCaseResult, Round3PowerEvent } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import type { Task, SubmissionResult, Submission, Activity, ActivitySession } from '../../types';
import { useFullscreenLockdown } from '../../hooks/useFullscreenLockdown';
import { useBeforeUnload } from '../../hooks/useBeforeUnload';


const ACTIVITY_LABELS: Record<string, { icon: string; description: string }> = {
  DUMB_CHARADES: {
    icon: '🎭',
    description: 'Watch the clue performed by the host. Write a C program that prints your guessed answer.',
  },
  BLIND_CODING: {
    icon: '💻',
    description: 'Read the problem carefully. Write a complete C solution that produces the correct output.',
  },
  CODE_DEBUGGING: {
    icon: '🐛',
    description: 'Analyse the buggy C code provided. Find and fix all the errors, then submit your corrected code.',
  },
  CODING_SPRINT: {
    icon: '🏃',
    description: 'Solve the coding problem. Run all test cases — once they all pass, submit your solution.',
  },
};

function formatStatus(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    ACCEPTED: { label: '✓ Correct', className: 'badge-success' },
    WRONG_ANSWER: { label: '✗ Wrong Answer', className: 'badge-error' },
    COMPILE_ERROR: { label: 'Compile Error', className: 'badge-error' },
    RUNTIME_ERROR: { label: 'Runtime Error', className: 'badge-error' },
    TIME_LIMIT_EXCEEDED: { label: 'Time Limit', className: 'badge-warning' },
    MEMORY_LIMIT_EXCEEDED: { label: 'Memory Limit', className: 'badge-warning' },
    SYSTEM_ERROR: { label: 'System Error', className: 'badge-error' },
    PENDING: { label: 'Pending', className: 'badge-muted' },
  };
  return map[status] ?? { label: status, className: 'badge-muted' };
}

/** Parse GCC/Clang error output into structured lines for display */
function parseCompileErrors(raw: string): Array<{ line: number | null; col: number | null; kind: string; message: string; rawLine: string }> {
  if (!raw) return [];
  // Matches: solution.c:LINE:COL: error: msg  OR  solution.c:LINE: error: msg
  const pattern = /^[^:]+:(\d+)(?::(\d+))?:\s*(error|warning|note):\s*(.+)$/;
  return raw.split('\n').filter(l => l.trim()).map(l => {
    const m = l.match(pattern);
    if (m) return { line: parseInt(m[1], 10), col: m[2] ? parseInt(m[2], 10) : null, kind: m[3], message: m[4], rawLine: l };
    return { line: null, col: null, kind: 'error', message: l, rawLine: l };
  });
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Custom hook: Per-activity timer ─────────────────────────────────────────

function useActivityTimer(session: ActivitySession | null): number {
  const computeRemaining = useCallback(() => {
    if (!session) return 0;
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    return Math.max(0, session.durationMs - elapsed);
  }, [session]);

  const [remainingMs, setRemainingMs] = useState(computeRemaining);

  useEffect(() => {
    setRemainingMs(computeRemaining());
    if (!session) return;
    const interval = setInterval(() => {
      const rem = computeRemaining();
      setRemainingMs(rem);
      if (rem <= 0) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [session, computeRemaining]);

  return remainingMs;
}

// ─── Activity Chooser ───────────────────────────────────────────────────────

interface ActivityChooserProps {
  activities: Activity[];
  sessions: ActivitySession[];
  onSelect: (activity: Activity) => void;
  onStart: (activity: Activity) => Promise<void>;
  starting: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  onDashboard?: () => void;
}

function ActivityChooser({ activities, sessions, onSelect, onStart, starting, onRefresh, refreshing, onDashboard }: ActivityChooserProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '32px',
      background: 'var(--bg-primary)',
      position: 'relative',
    }}>
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100, display: 'flex', gap: 8 }}>
        {onRefresh && (
          <button
            id="chooser-refresh-btn"
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh round status"
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {onDashboard && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDashboard}
            title="Back to Dashboard"
          >
            Dashboard
          </button>
        )}
      </div>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 8, fontSize: '1.5rem', color: 'var(--text-primary)' }}>
          Round 1 — Choose Your Activity
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.9rem' }}>
          Each activity has a <strong>15-minute timer</strong> that starts when you click "Start".
          You can do them in any order.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activities.map(activity => {
            const session = sessions.find(s => s.activityId === activity.id) ?? null;
            const isStarted = !!session;
            const isExpired = session
              ? (Date.now() - new Date(session.startedAt).getTime()) >= session.durationMs
              : false;
            const label = ACTIVITY_LABELS[activity.type] ?? { icon: '📋', description: '' };
            const taskCount = activity.tasks.length;

            return (
              <div
                key={activity.id}
                className="card"
                style={{
                  padding: '24px',
                  border: `2px solid ${isStarted && !isExpired ? 'var(--color-primary)' : isExpired ? 'var(--color-error, #ef4444)' : 'var(--border-color)'}`,
                  opacity: isExpired ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>{label.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--text-primary)' }}>
                        {activity.name}
                      </h3>
                      {isStarted && !isExpired && (
                        <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>IN PROGRESS</span>
                      )}
                      {isExpired && (
                        <span className="badge badge-error" style={{ fontSize: '0.7rem' }}>TIME UP</span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {label.description}
                    </p>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      <span>⏱ 15 minutes</span>
                      <span>📝 {taskCount} question{taskCount !== 1 ? 's' : ''}</span>
                      {isStarted && !isExpired && (
                        <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                          {formatMs(session!.remainingMs)} remaining
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {!isStarted && !isExpired && (
                      <button
                        id={`start-activity-${activity.type.toLowerCase()}`}
                        className="btn btn-primary btn-sm"
                        onClick={() => void onStart(activity)}
                        disabled={starting === activity.id}
                      >
                        {starting === activity.id ? 'Starting…' : '▶ Start'}
                      </button>
                    )}
                    {isStarted && !isExpired && (
                      <button
                        id={`continue-activity-${activity.type.toLowerCase()}`}
                        className="btn btn-success btn-sm"
                        onClick={() => onSelect(activity)}
                      >
                        Continue →
                      </button>
                    )}
                    {isExpired && (
                      <button className="btn btn-secondary btn-sm" disabled>Ended</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Once started, each activity timer runs independently. Good luck! 🚀
        </p>
      </div>
    </div>
  );
}

// ─── Coding Screen ──────────────────────────────────────────────────────────

export default function CodingScreen() {
  const { theme } = useTheme();
  const { currentRound, socket, remainingMs: roundRemainingMs, isPaused, round3Power, clearRound3Power, refreshCompetition } = useCompetition();
  const { user } = useAuth();

  // Which activity the user is currently working on (null = chooser view)
  const [activeActivity, setActiveActivity] = useState<Activity | null>(null);

  // ── Round context ──────────────────────────────────────────────────────────
  const isRound2 = currentRound?.roundNumber === 2 || activeActivity?.type === 'CODE_DEBUGGING';
  const isRound3 = currentRound?.roundNumber === 3 || activeActivity?.type === 'CODING_SPRINT';

  // Activity sessions from backend (for timer restore on refresh)
  const [sessions, setSessions] = useState<ActivitySession[]>([]);

  // Tasks for current activity
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [solvedTaskIds, setSolvedTaskIds] = useState<Set<string>>(new Set());

  // Editor always starts completely blank — user writes full C program from scratch
  const getDefaultCode = (_activityType?: string) => '';

  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [blindSubmitted, setBlindSubmitted] = useState(false);
  const [lastResultIsRun, setLastResultIsRun] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string>('');

  // Output / result
  const [lastResult, setLastResult] = useState<SubmissionResult | null>(null);
  const [outputType, setOutputType] = useState<'none' | 'success' | 'error' | 'run'>('none');

  // Previous submissions for current task
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);

  // ── Round 3 state ──────────────────────────────────────────────────────────
  // Test case results from the last Run
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [allTestsPassed, setAllTestsPassed] = useState(false);
  const [round3Submitted, setRound3Submitted] = useState(false);

  // Keyboard freeze
  const [isFrozen, setIsFrozen] = useState(false);
  const [freezeRemainingMs, setFreezeRemainingMs] = useState(0);
  const freezeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Power notification popup (5 second auto-dismiss)
  const [powerNotif, setPowerNotif] = useState<Round3PowerEvent | null>(null);
  const powerNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Round 3 per-participant timer offset from power cards (Time Warp = -240000, Turbo Boost = +240000)
  const [r3TimerOffsetMs, setR3TimerOffsetMs] = useState<number>(0);

  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCompetition();
      if (!isRound2 && !isRound3 && currentRound?.id) {
        const res = await api.getMyActivitySessions();
        if (res.success && res.data) setSessions(res.data as ActivitySession[]);
      }
    } finally {
      setRefreshing(false);
    }
  };

  // Reset round-specific state when round ID changes
  useEffect(() => {
    setActiveActivity(null);
    setActiveTask(null);
    setTasks([]);
    setSolvedTaskIds(new Set());
    setMySubmissions([]);
    setLastResult(null);
    setOutputType('none');
    setBlindSubmitted(false);
    setTestResults([]);
    setAllTestsPassed(false);
    setRound3Submitted(false);
    setIsFrozen(false);
    setFreezeRemainingMs(0);
    setR3TimerOffsetMs(0);
    setCode('');
  }, [currentRound?.id]);


  // Per-activity timer (Round 1 only)
  const currentSession = (!isRound2 && activeActivity)
    ? sessions.find(s => s.activityId === activeActivity.id) ?? null
    : null;
  const activityRemainingMs = useActivityTimer(currentSession);
  // Compute expiry:
  //   Round 1 — per-participant session timestamp
  //   Round 2/3 — round-level (admin stops/ends it; expired = round not ACTIVE)
  const activityExpired = (isRound2 || isRound3)
    ? (currentRound?.status !== 'ACTIVE' || (isRound3 && roundRemainingMs !== null && (roundRemainingMs + r3TimerOffsetMs) <= 0))
    : currentSession !== null &&
      (Date.now() - new Date(currentSession.startedAt).getTime()) >= currentSession.durationMs;


  // Fullscreen lockdown
  const handleFocusLost = useCallback(() => {
    if (!currentRound?.id || !user?.participantId) return;
    const payload: AuditEventPayload = {
      eventType: 'FOCUS_LOST',
      metadata: { roundId: currentRound.id, activityId: activeActivity?.id },
    };
    socket?.emit('audit:event', payload);
  }, [currentRound?.id, user?.participantId, activeActivity?.id, socket]);

  const { isFullscreen, focusLost, focusLostCount, requestFullscreen } = useFullscreenLockdown({
    enabled: currentRound?.status === 'ACTIVE',
    onFocusLost: handleFocusLost,
  });

  useBeforeUnload(currentRound?.status === 'ACTIVE');

  // Purge any legacy cached code containing boilerplate or printf
  useEffect(() => {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('fcf-code-') && !k.startsWith('fcf-code-v2-')) {
          localStorage.removeItem(k);
        }
      });
    } catch {
      // ignore
    }
  }, []);

  // Load sessions on mount (Round 1 only — Round 2/3 have no per-participant sessions)
  useEffect(() => {
    if (!currentRound?.id || isRound2 || isRound3) return;
    api.getMyActivitySessions()
      .then(res => {
        if (res.success && res.data) setSessions(res.data as ActivitySession[]);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.id, isRound2, isRound3]);

  // Round 2: auto-enter the CODE_DEBUGGING activity when round becomes active
  useEffect(() => {
    if (!isRound2 || !currentRound || currentRound.status !== 'ACTIVE') return;
    const debugActivity = currentRound.activities.find(a => a.type === 'CODE_DEBUGGING');
    if (debugActivity && (!activeActivity || activeActivity.id !== debugActivity.id)) {
      setActiveActivity(debugActivity);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRound2, currentRound?.status, currentRound?.activities?.length]);

  // Round 3: auto-enter the CODING_SPRINT activity when round becomes active
  useEffect(() => {
    if (!isRound3 || !currentRound || currentRound.status !== 'ACTIVE') return;
    const sprintActivity = currentRound.activities.find(a => a.type === 'CODING_SPRINT');
    if (sprintActivity && (!activeActivity || activeActivity.id !== sprintActivity.id)) {
      setActiveActivity(sprintActivity);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRound3, currentRound?.status, currentRound?.activities?.length]);

  // Round 3: restore freeze + personal timer state on page refresh
  useEffect(() => {
    if (!isRound3) return;
    api.getMyRound3Status().then((res) => {
      if (!res.success || !res.data) return;
      const { isFrozen: frozen, freezeRemainingMs: fMs, freezeEndMs, timerOffsetMs } = res.data;
      if (frozen && freezeEndMs) {
        setIsFrozen(true);
        setFreezeRemainingMs(fMs);
        // Start countdown interval to track freeze locally
        if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current);
        freezeIntervalRef.current = setInterval(() => {
          const rem = Math.max(0, freezeEndMs - Date.now());
          setFreezeRemainingMs(rem);
          if (rem === 0) {
            setIsFrozen(false);
            if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current);
          }
        }, 500);
      }
      if (typeof timerOffsetMs === 'number') setR3TimerOffsetMs(timerOffsetMs);
    }).catch(() => {});
    return () => { if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRound3]);

  // Round 3: handle incoming power event from CompetitionContext
  useEffect(() => {
    if (!round3Power) return;
    setPowerNotif(round3Power);
    if (powerNotifTimerRef.current) clearTimeout(powerNotifTimerRef.current);
    powerNotifTimerRef.current = setTimeout(() => {
      setPowerNotif(null);
      clearRound3Power();
    }, 5000);

    if (round3Power.power === 'freeze' && round3Power.freezeEndMs) {
      const { freezeEndMs, durationMs } = round3Power;
      setIsFrozen(true);
      setFreezeRemainingMs(durationMs ?? 180000);
      if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current);
      freezeIntervalRef.current = setInterval(() => {
        const rem = Math.max(0, (freezeEndMs as number) - Date.now());
        setFreezeRemainingMs(rem);
        if (rem === 0) {
          setIsFrozen(false);
          if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current);
        }
      }, 500);
    } else if (round3Power.power === 'time_warp' || round3Power.power === 'turbo_boost') {
      if (typeof round3Power.timerOffsetMs === 'number') {
        setR3TimerOffsetMs(round3Power.timerOffsetMs);
      } else if (round3Power.deltaMs !== undefined) {
        setR3TimerOffsetMs((prev) => prev + round3Power.deltaMs!);
      }
    }
    return () => { if (powerNotifTimerRef.current) clearTimeout(powerNotifTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round3Power]);

  // Load tasks when active activity changes
  useEffect(() => {
    if (!activeActivity) { setTasks([]); return; }
    api.getTasksForActivity(activeActivity.id)
      .then(res => {
        if (res.success && res.data) {
          const t = res.data as Task[];
          setTasks(t);
          if (t.length > 0) setActiveTask(t[0]);
        }
      })
      .catch(() => {});
  }, [activeActivity?.id]);

  // Load submissions to know solved tasks
  useEffect(() => {
    if (!currentRound?.id) return;
    api.getMySubmissions(currentRound.id)
      .then(res => {
        if (res.success && res.data) {
          const subs = res.data as Submission[];
          setSolvedTaskIds(new Set(subs.filter(s => s.isCorrect && s.taskId).map(s => s.taskId!)));
          setMySubmissions(subs);
        }
      })
      .catch(() => {});
  }, [currentRound?.id, activeActivity?.id]);

  // Restore code from localStorage when task changes
  // For CODE_DEBUGGING: pre-fill with starterCode if no saved code yet
  // For CODING_SPRINT: pre-fill with function stub (starterCode) if no saved code yet
  useEffect(() => {
    if (!activeTask) return;
    const isBlindCoding = activeActivity?.type === 'BLIND_CODING';
    const isCodeDebugging = activeActivity?.type === 'CODE_DEBUGGING';
    const isSprint = activeActivity?.type === 'CODING_SPRINT';
    const saved = localStorage.getItem(`fcf-code-v2-${activeTask.id}`);

    if (isCodeDebugging || isSprint) {
      // Use saved edit if exists, else pre-fill with starterCode
      if (saved) {
        setCode(saved);
      } else {
        const starter = activeTask.starterCode ?? '';
        setCode(starter);
        // Persist starter so refresh restores the pre-fill
        if (starter && activeTask) localStorage.setItem(`fcf-code-v2-${activeTask.id}`, starter);
      }
    } else if (isBlindCoding && saved && (saved.includes('printf(') || saved.includes('// Write your answer'))) {
      // BLIND_CODING: purge stale legacy boilerplate
      localStorage.removeItem(`fcf-code-v2-${activeTask.id}`);
      setCode('');
    } else {
      setCode(saved ?? '');
    }

    setLastResult(null);
    setOutputType('none');
    setBlindSubmitted(false);
    setLastResultIsRun(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask?.id, activeActivity?.id]);

  const handleCodeChange = useCallback((value: string | undefined) => {
    const v = value ?? '';
    setCode(v);
    if (activeTask) localStorage.setItem(`fcf-code-v2-${activeTask.id}`, v);
  }, [activeTask]);

  // Start an activity (user-triggered)
  const handleStartActivity = async (activity: Activity) => {
    setStarting(activity.id);
    setStartError('');
    try {
      const res = await api.startActivity(activity.id);
      if (res.success && res.data) {
        // Clear all cached code so activity editor starts completely empty
        try {
          Object.keys(localStorage).forEach(k => {
            if (k.startsWith('fcf-code-')) {
              localStorage.removeItem(k);
            }
          });
        } catch {
          // ignore
        }
        setCode('');

        const newSession: ActivitySession = {
          activityId: res.data.activityId as string,
          activityName: activity.name,
          activityType: activity.type,
          startedAt: res.data.startedAt as string,
          endedAt: null,
          durationMs: res.data.durationMs as number,
          remainingMs: res.data.durationMs as number,
        };
        // Update sessions first, then switch view — both in same batch (React 18)
        setSessions(prev => [...prev.filter(s => s.activityId !== activity.id), newSession]);
        setActiveActivity(activity);
      } else {
        setStartError('Failed to start activity. Please try again.');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setStartError(e.response?.data?.message ?? 'Failed to start activity. Please try again.');
    } finally {
      setStarting(null);
    }
  };

  const handleRun = async () => {
    if (!currentRound?.id || !activeTask) return;
    // Round 3: block Run when frozen
    if (isRound3 && isFrozen) return;
    setRunning(true);
    setLastResult(null);
    setTestResults([]);
    try {
      const res = await api.submit({
        roundId: currentRound.id,
        taskId: activeTask.id,
        sourceCode: code,
        isRunOnly: true,
      });
      if (res.success && res.data) {
        const result = res.data as SubmissionResult & { testResults?: TestCaseResult[] };
        setLastResult(result);
        setLastResultIsRun(true);
        if (isRound3 && result.testResults) {
          setTestResults(result.testResults);
          // If compile error — all tests fail; mark error even if testResults is empty
          const hasCompileErr = !!(result.compileError ||
            (result.testResults.length > 0 && result.testResults[0]?.compileError));
          const passed = !hasCompileErr && result.testResults.every(r => r.passed);
          setAllTestsPassed(passed);
          setOutputType(hasCompileErr ? 'error' : passed ? 'run' : 'error');
        } else {
          setOutputType(result.status === 'ACCEPTED' ? 'run' : 'error');
        }
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setLastResult({
        submissionId: '',
        status: 'SYSTEM_ERROR',
        isCorrect: false,
        score: 0,
        attemptNumber: 0,
        message: e.response?.data?.message ?? 'Failed to connect to compiler',
      });
      setOutputType('error');
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentRound?.id || !activeTask) return;
    // Block when frozen (Round 3)
    if (isRound3 && isFrozen) return;
    // Block submit when round is not ACTIVE
    if (activityExpired) return;
    // Round 2/3 also: block when round is paused
    if ((isRound2 || isRound3) && isPaused) return;
    const isBlindCoding = activeActivity?.type === 'BLIND_CODING';
    const isCodeDebugging = activeActivity?.type === 'CODE_DEBUGGING';
    const isCodingSprint = activeActivity?.type === 'CODING_SPRINT';
    // Round 2 (CODE_DEBUGGING): single submission only
    if (isCodeDebugging && (blindSubmitted || mySubmissions.some(s => s.taskId === activeTask.id))) return;
    // Round 3 (CODING_SPRINT): block if not all tests passed
    if (isCodingSprint && !allTestsPassed) return;
    // Round 3: block if already submitted winner
    if (isCodingSprint && round3Submitted) return;
    // For non-BLIND_CODING / non-CODE_DEBUGGING / non-CODING_SPRINT: block resubmit of already-solved tasks
    if (!isBlindCoding && !isCodeDebugging && !isCodingSprint && solvedTaskIds.has(activeTask.id)) return;

    setSubmitting(true);
    setLastResult(null);
    try {
      const res = await api.submit({
        roundId: currentRound.id,
        taskId: activeTask.id,
        sourceCode: code,
        isRunOnly: false,
      });
      if (res.success && res.data) {
        const result = res.data as SubmissionResult & { testResults?: TestCaseResult[] };
        setLastResult(result);
        setLastResultIsRun(false);

        if (isCodingSprint) {
          setOutputType('success');
          setRound3Submitted(true);
          if (result.testResults) setTestResults(result.testResults);
        } else if (isBlindCoding || isCodeDebugging) {
          // Neutral confirmation
          setOutputType('run');
          setBlindSubmitted(true);
        } else if (result.isCorrect) {
          setOutputType('success');
          setSolvedTaskIds(prev => new Set([...prev, activeTask.id]));
          const nextTask = tasks.find(t => t.id !== activeTask.id && !solvedTaskIds.has(t.id));
          if (nextTask) setTimeout(() => setActiveTask(nextTask), 1500);
        } else {
          setOutputType('error');
        }
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setLastResult({
        submissionId: '',
        status: 'SYSTEM_ERROR',
        isCorrect: false,
        score: 0,
        attemptNumber: 0,
        message: e.response?.data?.message ?? 'Submission failed',
      });
      setOutputType('error');
    } finally {
      setSubmitting(false);
    }
  };

  const roundActive = currentRound?.status === 'ACTIVE';
  const isSolved = activeTask ? solvedTaskIds.has(activeTask.id) : false;
  const isCodeDebugging = activeActivity?.type === 'CODE_DEBUGGING';
  const isCodingSprint = activeActivity?.type === 'CODING_SPRINT';
  const isRound2Submitted = isCodeDebugging && (blindSubmitted || (activeTask ? mySubmissions.some(s => s.taskId === activeTask.id) : false));
  const attemptCount = activeTask
    ? mySubmissions.filter(s => s.taskId === activeTask.id && !s.isCorrect).length
    : 0;
  // Displayed remaining time: Round 3 applies participant's power offset to the live ticking round timer
  const displayRemainingMs = isRound3
    ? (roundRemainingMs != null ? Math.max(0, roundRemainingMs + r3TimerOffsetMs) : null)
    : roundRemainingMs;
  // Round 1: all activities in the round. Round 2/3: not used (no chooser).
  const allActivities = currentRound?.activities ?? [];

  const renderFloatingControls = () => (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', gap: 8 }}>
      <button
        id="prompt-refresh-btn"
        className="btn btn-secondary btn-sm"
        onClick={handleRefresh}
        disabled={refreshing}
        title="Refresh round status"
      >
        <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => navigate('/participant')}
        title="Go to Dashboard"
      >
        Dashboard
      </button>
    </div>
  );

  // ── Round 2: Paused screen ─────────────────────────────────────────────────
  if (isRound2 && isPaused) {
    return (
      <div className="fullscreen-prompt">
        {renderFloatingControls()}
        {focusLost && (
          <div className="focus-warning-bar">
            ⚠ Warning: You left the competition window! ({focusLostCount} time{focusLostCount !== 1 ? 's' : ''})
            This has been recorded.
          </div>
        )}
        <div className="fullscreen-prompt-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⏸</div>
          <h2 style={{ marginBottom: '8px' }}>Round 2 — Paused</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            The admin has paused the round. Please wait — the timer will resume shortly.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="btn btn-secondary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
              {refreshing ? 'Checking…' : 'Refresh Status'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Round 3: Paused screen ─────────────────────────────────────────────────
  if (isRound3 && isPaused) {
    return (
      <div className="fullscreen-prompt">
        {renderFloatingControls()}
        {focusLost && (
          <div className="focus-warning-bar">
            ⚠ Warning: You left the competition window! ({focusLostCount} time{focusLostCount !== 1 ? 's' : ''})
            This has been recorded.
          </div>
        )}
        <div className="fullscreen-prompt-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⏸</div>
          <h2 style={{ marginBottom: '8px' }}>Round 3 — Paused</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            The admin has paused the round. Please wait — the timer will resume shortly.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="btn btn-secondary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
              {refreshing ? 'Checking…' : 'Refresh Status'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fullscreen prompt
  if (roundActive && !isFullscreen) {
    return (
      <div className="fullscreen-prompt">
        {focusLost && (
          <div className="focus-warning-bar">
            ⚠ Warning: You left the competition window! ({focusLostCount} time{focusLostCount !== 1 ? 's' : ''})
            This has been recorded.
          </div>
        )}
        <div className="fullscreen-prompt-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⛶</div>
          <h2 style={{ marginBottom: '8px' }}>Fullscreen Required</h2>
          <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
            The competition must run in fullscreen mode. Click below to enter.
          </p>
          <button id="enter-fullscreen" className="btn btn-primary btn-lg" onClick={requestFullscreen}>
            Enter Fullscreen & Start
          </button>
        </div>
      </div>
    );
  }

  // Waiting for round to start / paused / ended
  if (!roundActive) {
    return (
      <div className="fullscreen-prompt">
        {renderFloatingControls()}
        <div className="fullscreen-prompt-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
            {currentRound?.status === 'ENDED' ? '🏁' : '⏳'}
          </div>
          <h2 style={{ marginBottom: '8px' }}>
            {currentRound?.status === 'ENDED'
              ? `${currentRound.name} — Ended`
              : isRound2
              ? 'Waiting for Admin to Start Round 2…'
              : isRound3
              ? 'Waiting for Admin to Start Round 3…'
              : 'Competition Starting Soon'}
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {currentRound?.status === 'ENDED'
              ? 'This round has ended. Please wait for further instructions.'
              : 'Please wait. The round will begin automatically.'}
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              id="round-ended-refresh-btn"
              className="btn btn-primary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking for new round…' : 'Refresh for Next Round'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/participant')}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Activity chooser (Round 1 only — no active activity selected)
  // Round 2 never reaches this: activeActivity is auto-set in useEffect above
  if (!activeActivity) {
    // Extra safety: if somehow we land here in Round 2 without an activity yet, show spinner
    if (isRound2) {
      return (
        <div className="fullscreen-prompt">
          {renderFloatingControls()}
          <div className="fullscreen-prompt-card">
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Loading Code Debugging task…</p>
          </div>
        </div>
      );
    }
    return (
      <>
        {focusLost && (
          <div className="focus-warning-bar">
            ⚠ Warning: You left the competition window! ({focusLostCount} time{focusLostCount !== 1 ? 's' : ''})
            This has been recorded.
          </div>
        )}
        <ActivityChooser
          activities={allActivities}
          sessions={sessions}
          onSelect={setActiveActivity}
          onStart={handleStartActivity}
          starting={starting}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onDashboard={() => navigate('/participant')}
        />
        {startError && (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--color-error, #ef4444)', color: '#fff',
            padding: '10px 20px', borderRadius: 8, fontWeight: 500, zIndex: 9999,
          }}>
            ⚠ {startError}
            <button
              onClick={() => setStartError('')}
              style={{ marginLeft: 12, background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
            >✕</button>
          </div>
        )}
      </>
    );
  }

  // Activity/round time expired or ended screen
  if (activityExpired) {
    if (isRound2) {
      return (
        <div className="fullscreen-prompt">
          {renderFloatingControls()}
          <div className="fullscreen-prompt-card">
            <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🏁</div>
            <h2 style={{ marginBottom: '8px' }}>Round 2 — Ended</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
              The admin has ended Round 2. Thank you for participating!
            </p>
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                id="r2-ended-refresh-btn"
                className="btn btn-primary"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                {refreshing ? 'Checking for new round…' : 'Refresh for Next Round'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigate('/participant')}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (isRound3) {
      return (
        <div className="fullscreen-prompt">
          {renderFloatingControls()}
          <div className="fullscreen-prompt-card">
            <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🏁</div>
            <h2 style={{ marginBottom: '8px' }}>Round 3 — Ended</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
              {round3Submitted
                ? '🏆 Your solution has been submitted! The admin will announce the winner shortly.'
                : 'Round 3 has ended. Thank you for participating!'}
            </p>
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                id="r3-ended-refresh-btn"
                className="btn btn-primary"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                {refreshing ? 'Checking…' : 'Refresh Status'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigate('/participant')}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="fullscreen-prompt">
        {renderFloatingControls()}
        <div className="fullscreen-prompt-card">
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⏰</div>
          <h2 style={{ marginBottom: '8px' }}>{activeActivity.name} — Time's Up!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            You solved {[...solvedTaskIds].filter(id => tasks.find(t => t.id === id)).length} of {tasks.length} questions.
          </p>
          {allActivities.some(a => a.id !== activeActivity.id && !sessions.find(s => s.activityId === a.id)) && (
            <button
              className="btn btn-primary"
              onClick={() => setActiveActivity(null)}
            >
              Start Next Activity
            </button>
          )}
          {allActivities.every(a => sessions.find(s => s.activityId === a.id)) && (
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                All activities completed. Please wait for further instructions.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  id="r1-all-done-refresh-btn"
                  className="btn btn-primary"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                  {refreshing ? 'Checking for new round…' : 'Refresh for Next Round'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => navigate('/participant')}
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Coding interface
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Focus loss warning */}
      {focusLost && (
        <div className="focus-warning-bar">
          ⚠ Warning: You left the competition window! ({focusLostCount} time{focusLostCount !== 1 ? 's' : ''})
          This has been recorded.
        </div>
      )}

      {/* Top bar */}
      <div className="top-bar">
        {/* Back button: Round 1 only — Round 2/3 has no activity chooser */}
        {!isRound2 && !isRound3 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setActiveActivity(null)}
            style={{ marginRight: 8 }}
            title="Back to activity chooser"
          >
            ← Activities
          </button>
        )}
        <span className="top-bar-title">
          {ACTIVITY_LABELS[activeActivity.type]?.icon} {activeActivity.name}
        </span>
        <div className="top-bar-spacer" />
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginRight: 12 }}>
          {user?.displayName}
        </span>
        <button
          id="coding-screen-refresh-btn"
          className="btn btn-ghost btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh round status"
          style={{ marginRight: 12 }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {/* Timer: Round 2/3 uses admin-controlled round timer; Round 1 uses per-session timer */}
        {(() => {
          if ((isRound2 || isRound3) && displayRemainingMs == null) {
            return (
              <div style={{
                fontFamily: 'monospace', fontSize: '1.125rem', fontWeight: 700,
                color: 'var(--text-muted)', background: 'var(--bg-secondary)',
                padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-color)',
              }}>
                ⏱ --:--
              </div>
            );
          }
          const displayMs = (isRound2 || isRound3) ? (displayRemainingMs as number) : activityRemainingMs;
          const freezeWarning = isRound3 && isFrozen;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {freezeWarning && (
                <span style={{
                  background: '#6366f1', color: '#fff', padding: '3px 10px',
                  borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                }}>
                  ⌨️ FROZEN {Math.ceil(freezeRemainingMs / 1000)}s
                </span>
              )}
              <div style={{
                fontFamily: 'monospace',
                fontSize: '1.125rem',
                fontWeight: 700,
                color: displayMs < 120_000 ? 'var(--color-error, #ef4444)' : 'var(--text-primary)',
                background: 'var(--bg-secondary)',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--border-color)',
              }}>
                ⏱ {formatMs(displayMs)}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Round 3: Power notification popup (5s) */}
      {powerNotif && (
        <div style={{
          position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10000, minWidth: 340, maxWidth: 480,
          background: powerNotif.power === 'freeze' ? '#6366f1'
            : powerNotif.power === 'time_warp' ? '#ef4444'
            : '#22c55e',
          color: '#fff', padding: '16px 24px', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          fontWeight: 600, fontSize: '1rem', textAlign: 'center',
          animation: 'fadeInDown 0.3s ease',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>
            {powerNotif.power === 'freeze' ? '⌨️' : powerNotif.power === 'time_warp' ? '⏪' : '🚀'}
          </div>
          {powerNotif.message}
          <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 6 }}>Auto-dismisses in 5 seconds</div>
        </div>
      )}

      {/* Round 3: Keyboard freeze overlay */}
      {isRound3 && isFrozen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(99, 102, 241, 0.12)',
          pointerEvents: 'none',
          border: '4px solid #6366f1',
          boxSizing: 'border-box',
        }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#6366f1', color: '#fff',
            padding: '12px 28px', borderRadius: 12,
            fontSize: '1.125rem', fontWeight: 700,
            pointerEvents: 'none',
            boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
          }}>
            ⌨️ KEYBOARD FROZEN — {Math.ceil(freezeRemainingMs / 1000)}s remaining
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="coding-layout" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Left: problem panel */}
        <div className="problem-panel">
          <div className="problem-header">
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Questions</span>
            <span className="badge badge-info">{solvedTaskIds.size}/{tasks.length} solved</span>
          </div>

          <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <div className="question-list">
              {tasks.map((task, i) => (
                <div
                  key={task.id}
                  id={`question-${i + 1}`}
                  className={[
                    'question-item',
                    solvedTaskIds.has(task.id) ? 'solved' : '',
                    activeTask?.id === task.id && !solvedTaskIds.has(task.id) ? 'active' : '',
                  ].join(' ')}
                  onClick={() => !solvedTaskIds.has(task.id) && setActiveTask(task)}
                  style={{ cursor: solvedTaskIds.has(task.id) ? 'default' : 'pointer' }}
                >
                  <div className="question-number">
                    {solvedTaskIds.has(task.id) ? '✓' : i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                      {task.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {task.points} pts{solvedTaskIds.has(task.id) && ' · Solved'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="problem-body">
            {activeTask ? (
              <>
                <h3 style={{ marginBottom: '12px' }}>{activeTask.title}</h3>
                <p style={{ marginBottom: '16px', whiteSpace: 'pre-wrap' }}>{activeTask.description}</p>

                <div className="card" style={{ marginBottom: '12px', padding: '12px' }}>
                  <div className="card-title" style={{ fontSize: '0.75rem', marginBottom: '6px' }}>INSTRUCTIONS</div>
                  <p style={{ fontSize: '0.8125rem' }}>
                    {activeActivity.type === 'BLIND_CODING'
                      ? 'Read the problem carefully. Write your complete C program from scratch in the compiler to produce the expected output.'
                      : activeActivity.type === 'CODE_DEBUGGING'
                      ? 'Analyse the buggy C code pre-loaded in the editor. Find and fix all intentional errors, then click Submit. You cannot run the code.'
                      : activeActivity.type === 'CODING_SPRINT'
                      ? 'Implement the function shown in the editor. Do NOT write main() or #include — the hidden driver handles that. Click ▶ Run to test your function. Submit unlocks when all test cases pass.'
                      : `${ACTIVITY_LABELS[activeActivity.type]?.description ?? 'Write a C program that produces the correct output.'} Write your answer in printf(). All answers are lowercase.`}
                  </p>
                </div>

                {activeTask.sampleOutput && (
                  <div className="card" style={{ padding: '12px' }}>
                    <div className="card-title" style={{ fontSize: '0.75rem', marginBottom: '6px' }}>EXAMPLE OUTPUT FORMAT</div>
                    <pre className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                      {activeTask.sampleOutput}
                    </pre>
                  </div>
                )}

                {/* Show solved/attempt count only for non-BLIND_CODING */}
                {activeActivity.type !== 'BLIND_CODING' && isSolved && (
                  <div className="alert alert-success" style={{ marginTop: '12px' }}>
                    ✓ Solved! +{activeTask.points} points
                  </div>
                )}
                {activeActivity.type !== 'BLIND_CODING' && !isSolved && attemptCount > 0 && (
                  <div className="alert alert-warning" style={{ marginTop: '12px' }}>
                    {attemptCount} incorrect attempt{attemptCount !== 1 ? 's' : ''}. Keep trying!
                  </div>
                )}
                {activeActivity.type === 'BLIND_CODING' && blindSubmitted && (
                  <div className="alert alert-info" style={{ marginTop: '12px' }}>
                    ✓ Code submitted. You may submit again if needed.
                  </div>
                )}
                {isCodeDebugging && isRound2Submitted && (
                  <div className="alert alert-info" style={{ marginTop: '12px' }}>
                    ✓ Code submitted! Only one submission is permitted for Round 2. Your response has been locked and recorded.
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>
                {tasks.length === 0 ? 'Loading questions…' : 'Select a question.'}
              </p>
            )}
          </div>
        </div>

        {/* Right: editor panel */}
        <div className="editor-panel">
          <div className="editor-toolbar">
            <span className="badge badge-muted font-mono" style={{ fontSize: '0.75rem' }}>C Language</span>
            <div className="flex-1" />
            <button
              id="clear-btn"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCode('');
                if (activeTask) {
                  localStorage.removeItem(`fcf-code-v2-${activeTask.id}`);
                  localStorage.removeItem(`fcf-code-${activeTask.id}`);
                }
              }}
              title="Reset code to blank"
              disabled={running || submitting || (isSolved && activeActivity.type !== 'BLIND_CODING' && !isCodingSprint) || activityExpired || isRound2Submitted || round3Submitted}
            >
              ⟲ Reset
            </button>
            <button
              id="run-btn"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleRun()}
              disabled={running || submitting || !activeTask || isCodeDebugging || (isSolved && activeActivity.type !== 'BLIND_CODING' && !isCodingSprint) || activityExpired || (isRound3 && isFrozen) || round3Submitted}
              title={isCodeDebugging ? 'Run is disabled for Code Debugging — submit your code to check it'
                : isRound3 && isFrozen ? 'Keyboard is frozen — wait for freeze to expire'
                : isCodingSprint ? 'Run all test cases'
                : undefined}
            >
              {running ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Running…</> : '▶ Run'}
            </button>
            <button
              id="submit-btn"
              className={`btn btn-sm ${isCodingSprint && !allTestsPassed ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => void handleSubmit()}
              disabled={running || submitting || !activeTask || (isSolved && activeActivity.type !== 'BLIND_CODING' && !isCodingSprint) || activityExpired || isRound2Submitted || round3Submitted || (isCodingSprint && !allTestsPassed) || (isRound3 && isFrozen)}
              title={isCodingSprint && !allTestsPassed ? 'Run all test cases first — submit is unlocked when all pass' : undefined}
            >
              {round3Submitted
                ? '🏆 Submitted!'
                : isRound2Submitted
                ? '✓ Submitted'
                : submitting
                ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Submitting…</>
                : isCodingSprint && !allTestsPassed
                ? '🔒 Submit (Run first)'
                : '✓ Submit Answer'}
            </button>
          </div>

          <div className="editor-container">
            <Editor
              height="100%"
              language="c"
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              value={code}
              onChange={handleCodeChange}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                lineNumbers: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                bracketPairColorization: { enabled: true },
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
                formatOnPaste: true,
                renderWhitespace: 'selection',
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                readOnly: (isSolved && activeActivity.type !== 'BLIND_CODING' && !isCodingSprint) || activityExpired || isRound2Submitted || round3Submitted || (isRound3 && isFrozen),
              }}
            />
          </div>

            <div className="output-panel">
              <div className="output-header">
                <span>Output</span>
                {/* Hide status badge for BLIND_CODING and CODE_DEBUGGING */}
                {lastResult && activeActivity.type !== 'BLIND_CODING' && activeActivity.type !== 'CODE_DEBUGGING' && (
                  <span className={`badge ${formatStatus(lastResult.status).className}`}>
                    {formatStatus(lastResult.status).label}
                  </span>
                )}
                {lastResult?.executionTimeMs != null && activeActivity.type !== 'BLIND_CODING' && activeActivity.type !== 'CODE_DEBUGGING' && (
                  <span className="text-muted text-xs">{lastResult.executionTimeMs}ms</span>
                )}
              </div>
              <div className={`output-content ${outputType === 'success' ? 'output-success' : outputType === 'error' ? 'output-error' : ''}`}>
                {!lastResult && isRound2Submitted && (
                  <div style={{ color: 'var(--color-info)' }}>
                    ✓ Code submitted. Only one submission is permitted for Round 2.
                  </div>
                )}
                {!lastResult && round3Submitted && (
                  <div style={{ color: 'var(--color-success, #22c55e)' }}>
                    🏆 Solution submitted successfully! Waiting for admin to announce the winner.
                  </div>
                )}
                {!lastResult && !isRound2Submitted && !round3Submitted && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {isCodeDebugging ? 'Submit your corrected code to check it.'
                      : isCodingSprint ? 'Click ▶ Run to test all test cases. Submit unlocks when all pass.'
                      : 'Click Run to test your code, or Submit to check your answer.'}
                  </span>
                )}

                {/* CODE_DEBUGGING: always neutral — no output details leaked */}
                {lastResult && isCodeDebugging && (
                  <div>
                    <div>{lastResult.message}</div>
                    <div style={{ marginTop: '8px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      Note: Only one submission is permitted in Round 2. Your response has been locked.
                    </div>
                  </div>
                )}

                {lastResult && activeActivity.type === 'BLIND_CODING' && (
                  // BLIND_CODING branch: always show raw output (compile error, stderr, stdout)
                  // but NEVER show correctness, score, or pass/fail — even on submit
                  <>
                    {lastResult.compileError && (
                      <div><strong>Compile Error:</strong>{' '}{lastResult.compileError}</div>
                    )}
                    {!lastResult.compileError && lastResult.stderr && (
                      <div><strong>Runtime Error:</strong>{' '}{lastResult.stderr}</div>
                    )}
                    {!lastResult.compileError && lastResult.stdout && (
                      <div>{lastResult.stdout}</div>
                    )}
                    {!lastResult.compileError && !lastResult.stderr && !lastResult.stdout && (
                      // On Run with no output, or on Submit neutral message
                      <div>{lastResultIsRun ? '(no output)' : lastResult.message}</div>
                    )}
                  </>
                )}

                {lastResult && activeActivity.type !== 'BLIND_CODING' && activeActivity.type !== 'CODE_DEBUGGING' && activeActivity.type !== 'CODING_SPRINT' && (
                  // Non-BLIND_CODING/DEBUG/SPRINT: full output including correctness
                  <>
                    {lastResult.compileError && (
                      <div><strong>Compile Error:</strong>{' '}{lastResult.compileError}</div>
                    )}
                    {!lastResult.compileError && lastResult.stderr && (
                      <div><strong>Runtime Error:</strong>{' '}{lastResult.stderr}</div>
                    )}
                    {!lastResult.compileError && lastResult.stdout && (
                      <div>{lastResult.stdout}</div>
                    )}
                    {!lastResult.compileError && !lastResult.stderr && !lastResult.stdout && (
                      <div>{lastResult.message}</div>
                    )}
                  </>
                )}

                {/* CODING_SPRINT: compiler terminal output */}
                {isCodingSprint && lastResult && (
                  <div style={{ marginTop: 8 }}>
                    {(() => {
                      // Determine the compile error — check result-level and first test case
                      const compErr: string | null | undefined =
                        lastResult.compileError ||
                        (testResults.length > 0 ? testResults[0]?.compileError : null);

                      if (compErr) {
                        // ── Compilation Error view ──
                        const parsedErrors = parseCompileErrors(compErr);
                        return (
                          <div style={{
                            background: 'var(--bg-tertiary, #161622)',
                            borderRadius: 8,
                            border: '1px solid rgba(248,113,113,0.45)',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              background: 'rgba(239,68,68,0.18)',
                              padding: '8px 14px',
                              display: 'flex', alignItems: 'center', gap: 8,
                              borderBottom: '1px solid rgba(248,113,113,0.3)',
                            }}>
                              <span style={{ fontSize: '1rem' }}>🔴</span>
                              <span style={{ fontWeight: 700, color: '#f87171' }}>Compilation Error</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                Fix the errors below and try again
                              </span>
                            </div>
                            <div style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                              {parsedErrors.map((e, i) => (
                                <div key={i} style={{
                                  marginBottom: 6, paddingBottom: 6,
                                  borderBottom: i < parsedErrors.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                                }}>
                                  {e.line !== null && (
                                    <span style={{
                                      display: 'inline-block',
                                      background: e.kind === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.2)',
                                      color: e.kind === 'error' ? '#fca5a5' : '#fde68a',
                                      borderRadius: 4, padding: '1px 7px', marginRight: 8,
                                      fontWeight: 700, fontSize: '0.75rem',
                                    }}>
                                      Line {e.line}{e.col != null ? `:${e.col}` : ''}
                                    </span>
                                  )}
                                  <span style={{
                                    color: e.kind === 'error' ? '#f87171'
                                      : e.kind === 'warning' ? '#fbbf24'
                                      : 'var(--text-muted)',
                                    fontWeight: e.line !== null ? 600 : 400,
                                  }}>
                                    {e.kind === 'error' ? '✗' : e.kind === 'warning' ? '⚠' : 'ℹ'} {e.message}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      // ── Runtime / Wrong Answer view ──
                      // Check if any test has a runtime error
                      const runtimeErr = testResults.find(r => !r.passed && r.stderr && !r.compileError);

                      return (
                        <>
                          {runtimeErr && (
                            <div style={{
                              background: 'rgba(239,68,68,0.1)',
                              border: '1px solid rgba(239,68,68,0.35)',
                              borderRadius: 8, padding: '8px 14px',
                              marginBottom: 10, fontFamily: 'monospace', fontSize: '0.8125rem',
                            }}>
                              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 4 }}>⚠ Runtime Error (on first failing test case)</div>
                              <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{runtimeErr.stderr}</div>
                            </div>
                          )}
                          {testResults.length > 0 && (
                            <>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 8, color: 'var(--text-primary)' }}>
                                Test Results: {testResults.filter(r => r.passed).length}/{testResults.length} passed
                              </div>
                              {testResults.map((tc, i) => (
                                <div key={i} style={{
                                  border: `1px solid ${tc.passed ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                                  borderRadius: 8, marginBottom: 8, overflow: 'hidden',
                                }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '6px 12px',
                                    background: tc.passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                  }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: tc.passed ? '#22c55e' : '#ef4444' }}>
                                      {tc.passed ? '✓ PASS' : '✗ FAIL'}
                                    </span>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{tc.label}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                      {tc.executionTimeMs}ms
                                    </span>
                                  </div>
                                  {!tc.passed && (
                                    <div style={{ padding: '8px 12px', fontSize: '0.8125rem' }}>
                                      {tc.stderr ? (
                                        <div style={{ color: '#f87171', marginBottom: 4 }}>
                                          <strong>Runtime Error:</strong> {tc.stderr}
                                        </div>
                                      ) : (
                                        <>
                                          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                                            <strong>Your output:</strong>{' '}
                                            <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>
                                              {tc.stdout || '(empty)'}
                                            </code>
                                          </div>
                                          <div style={{ color: 'var(--text-muted)' }}>
                                            <strong>Expected:</strong>{' '}
                                            <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>
                                              {tc.expectedOutput}
                                            </code>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {allTestsPassed && !round3Submitted && (
                                <div style={{
                                  padding: '10px 14px', background: 'rgba(34,197,94,0.15)',
                                  borderRadius: 8, color: '#22c55e', fontWeight: 600,
                                  border: '1px solid rgba(34,197,94,0.4)', textAlign: 'center',
                                }}>
                                  🎉 All test cases passed! Click Submit Answer to submit your solution.
                                </div>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
