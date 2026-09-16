import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors: Record<string, string[]> = {};
    for (const error of errors.array()) {
      if ('path' in error) {
        const key = error.path as string;
        if (!fieldErrors[key]) fieldErrors[key] = [];
        fieldErrors[key].push(error.msg);
      }
    }
    const errorDetails = Object.entries(fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('; ');
    res.status(400).json({
      success: false,
      message: errorDetails ? `Validation failed: ${errorDetails}` : 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }
  next();
}
