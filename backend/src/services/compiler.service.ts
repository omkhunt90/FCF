import { config } from '../config/env';
import { CompilerRequest, CompilerResponse } from '../types';
import { createError } from '../middleware/error.middleware';
import { logger } from '../config/logger';

export async function executeCode(request: CompilerRequest): Promise<CompilerResponse> {
  const payload = {
    language: request.language,
    source_code: request.sourceCode,
    stdin: request.stdin ?? '',
    timeout_ms: Math.min(request.timeoutMs ?? config.DEFAULT_TIMEOUT_MS, 10_000),
    memory_limit_mb: Math.min(request.memoryLimitMb ?? config.DEFAULT_MEMORY_LIMIT_MB, 128),
  };

  let response: Response;
  try {
    response = await fetch(`${config.COMPILER_SERVICE_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.COMPILER_SERVICE_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(payload.timeout_ms + 5000), // extra buffer
    });
  } catch (err) {
    logger.error('Compiler service unreachable', { err });
    throw createError('Compiler service unavailable. Try again.', 503);
  }

  if (!response.ok) {
    logger.error('Compiler service returned error', { status: response.status });
    throw createError('Compiler service error', 502);
  }

  const data = (await response.json()) as CompilerResponse;
  return data;
}

/**
 * Normalize compiler stdout for answer comparison.
 * Rules:
 * - Trim leading/trailing whitespace
 * - Remove trailing newline
 * - Do NOT change case (competition instruction: lowercase only)
 */
export function normalizeOutput(output: string): string {
  return output.trim();
}

/**
 * Compare participant's program stdout with the stored correct answer.
 * Case-sensitive (participants instructed to output lowercase).
 */
export function compareAnswer(stdout: string, correctAnswer: string): boolean {
  return normalizeOutput(stdout) === normalizeOutput(correctAnswer);
}
