// Shared API types used across modules

export interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthTokenPayload {
  userId: string;
  role: 'PARTICIPANT' | 'ADMIN';
  participantId?: string; // only for PARTICIPANT role
}

export interface CompilerRequest {
  language: 'c';
  sourceCode: string;
  stdin?: string;
  timeoutMs?: number;
  memoryLimitMb?: number;
}

export type CompilerStatus =
  | 'accepted'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit_exceeded'
  | 'memory_limit_exceeded'
  | 'system_error';

export interface CompilerResponse {
  success: boolean;
  status: CompilerStatus;
  stdout: string;
  stderr: string;
  compileError: string | null;
  executionTimeMs: number;
  memoryUsedMb?: number;
}

// Safe task view — NEVER includes correctAnswer
export interface TaskView {
  id: string;
  title: string;
  description: string;
  sampleOutput: string | null;
  timeoutMs: number;
  points: number;
  orderIndex: number;
  isActive: boolean;
}

// Result returned to participant after submission
export interface SubmissionResult {
  submissionId: string;
  status: string;
  isCorrect: boolean;
  score: number;
  stdout?: string; // shown only if not sensitive (e.g. compile errors)
  compileError?: string;
  stderr?: string;
  executionTimeMs?: number;
  attemptNumber: number;
  message: string;
}
