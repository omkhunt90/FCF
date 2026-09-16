import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { AuthTokenPayload } from '../types';
import { logger } from '../config/logger';

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthTokenPayload;
    req.user = payload;
    next();
  } catch (error) {
    logger.debug('JWT verification failed', { error });
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'ADMIN') {
    logger.warn('Unauthorized admin access attempt', {
      userId: req.user.userId,
      role: req.user.role,
      path: req.path,
    });
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }
  next();
}

export function requireParticipant(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'PARTICIPANT') {
    res.status(403).json({ success: false, message: 'Participant access required' });
    return;
  }
  next();
}

// Self-or-admin: participant can only access their own data, admin can access any
export function requireSelfOrAdmin(paramKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    if (req.user.role === 'ADMIN') {
      next();
      return;
    }
    if (
      req.user.role === 'PARTICIPANT' &&
      req.user.participantId === req.params[paramKey]
    ) {
      next();
      return;
    }
    res.status(403).json({ success: false, message: 'Access denied' });
  };
}
