import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { config } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function createError(message: string, statusCode: number): AppError {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const isOperational = err.isOperational ?? false;

  if (!isOperational) {
    logger.error('Unexpected error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  // Never expose internal details in production
  const message =
    isOperational
      ? err.message
      : config.NODE_ENV === 'development'
        ? err.message
        : 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.NODE_ENV === 'development' && !isOperational
      ? { stack: err.stack }
      : {}),
  });
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
