// Shared frontend types matching backend responses

export type Role = 'PARTICIPANT' | 'ADMIN';

export type CompetitionStatus = 'NOT_STARTED' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
export type RoundStatus = 'UPCOMING' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type ActivityType = 'DUMB_CHARADES' | 'BLIND_CODING' | 'CODE_DEBUGGING' | 'CODING_SPRINT' | 'FUTURE_ACTIVITY';
export type SubmissionStatus =
  | 'PENDING' | 'COMPILING' | 'ACCEPTED' | 'WRONG_ANSWER'
  | 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED' | 'SYSTEM_ERROR';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  participantId?: string;
  displayName?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  sampleOutput: string | null;
  timeoutMs: number;
  points: number;
  orderIndex: number;
  questionBank: number | null;
  /** CODE_DEBUGGING: pre-filled buggy code shown in participant editor */
  starterCode?: string | null;
  /** CODE_DEBUGGING: error definitions – shown in admin UI only */
  config?: Record<string, unknown> | null;
  isActive: boolean;
}

export interface Activity {
  id: string;
  roundId: string;
  name: string;
  type: ActivityType;
  config: Record<string, unknown>;
  isActive: boolean;
  durationMs: number | null;
  tasks: Task[];
}

export interface Round {
  id: string;
  competitionId: string;
  name: string;
  roundNumber: number;
  durationMs: number;
  status: RoundStatus;
  startedAt: string | null;
  endedAt: string | null;
  activeActivityId: string | null;
  activities: Activity[];
}

export interface Competition {
  id: string;
  name: string;
  status: CompetitionStatus;
  startedAt: string | null;
  endedAt: string | null;
  currentRoundId: string | null;
  rounds: Round[];
  serverTime: number;
}

export interface Submission {
  id: string;
  taskId: string | null;
  attemptNumber: number;
  status: SubmissionStatus;
  isCorrect: boolean;
  score: number | null;
  compileError?: string;
  stderr?: string;
  executionTimeMs?: number;
  submittedAt: string;
}

export interface SubmissionResult {
  submissionId: string;
  status: SubmissionStatus;
  isCorrect: boolean;
  score: number;
  stdout?: string;
  compileError?: string;
  stderr?: string;
  executionTimeMs?: number;
  attemptNumber: number;
  message: string;
}

export interface Participant {
  id: string;
  displayName: string;
  teamName: string | null;
  isActive: boolean;
  assignedQuestionBank: number | null;
  user: { id: string; username: string; isActive: boolean };
  leaderboardEntry: LeaderboardEntry | null;
  _count: { submissions: number; auditEvents: number };
}

export interface LeaderboardEntry {
  rank?: number;
  participantId: string;
  displayName?: string;
  teamName?: string | null;
  totalScore: number;
  acceptedCount: number;
  lastAcceptedAt: string | null;
}

export interface LBRow {
  rank: number;
  participantId: string;
  displayName: string;
  teamName: string | null;
  totalScore: number;
  acceptedCount: number;
  totalAttempts: number;
  lastAcceptedAt: string | null;
}


export interface AuditEvent {
  id: string;
  participantId: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  participant?: { displayName: string; teamName: string | null };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
}

// WebSocket event payloads
export interface TimerSyncEvent {
  roundId: string;
  remainingMs: number;
  serverTs: number;
}

export interface RoundStateEvent {
  roundId: string;
  status: RoundStatus;
  startedAt: string | null;
  durationMs: number;
  /** Actual remaining ms at the moment of the state change — provided on pause/resume */
  remainingMs?: number;
}

export interface SubmissionResultEvent extends SubmissionResult {}

export interface AuditFlaggedEvent {
  participantId: string;
  eventType: string;
  occurredAt: string;
}

export interface AuditEventPayload {
  eventType: string;
  metadata?: Record<string, unknown>;
}

export interface ActivitySession {
  activityId: string;
  activityName: string;
  activityType: ActivityType;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  remainingMs: number;
}

/** Admin-only: per-error result for CODE_DEBUGGING submissions */
export interface DebugErrorResult {
  id: number;
  description: string;
  fixed: boolean;
}

/** Admin-only: full debug diff result returned by /submissions/:id/debug-result */
export interface DebugDiffResult {
  submissionId: string;
  participantName: string;
  teamName: string | null;
  taskTitle: string;
  attemptNumber: number;
  submittedAt: string;
  totalScore: number;
  isAllCorrect: boolean;
  debugResult: {
    errorsChecked: DebugErrorResult[];
    fixedCount: number;
    score: number;
  } | null;
}

/** Round 3 test case result */
export interface TestCaseResult {
  label: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  compileError: string | null;
  executionTimeMs: number;
  expectedOutput: string;
}

/** Round 3 admin power event received via WebSocket */
export interface Round3PowerEvent {
  power: 'freeze' | 'time_warp' | 'turbo_boost';
  message: string;
  durationMs?: number;
  freezeEndMs?: number;
  deltaMs?: number;
  timerOffsetMs?: number;
  newRemainingMs?: number;
  timestamp: number;
}
