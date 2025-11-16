/**
 * Admin controller - Auditable actions
 */

import type { Request, Response } from 'express';

import { admin } from '../events.js';
import { chronicleAudit } from '../services/chronicler.js';

export const performAdminAction = (req: Request, res: Response) => {
  const { action, resource } = req.body;
  const userId = (req.headers['x-user-id'] as string) || 'anonymous';

  if (!action) {
    return res.status(400).json({ error: 'Action is required' });
  }

  // Simulate admin action
  const success = Math.random() > 0.1; // 90% success rate

  // Log audit event
  chronicleAudit.event(admin.events.action, {
    action,
    userId,
    resource: resource || 'unknown',
    success,
  });

  if (!success) {
    return res.status(500).json({ error: 'Action failed' });
  }

  res.json({
    success: true,
    action,
    resource,
  });
};

export const loginAttempt = (req: Request, res: Response) => {
  const { userId, password } = req.body;
  const ip = req.ip || 'unknown';

  if (!userId || !password) {
    return res.status(400).json({ error: 'UserId and password required' });
  }

  // Simulate authentication
  const success = password === 'demo123';

  // Log audit event
  chronicleAudit.event(admin.events.login, {
    userId,
    success,
    ip,
  });

  if (!success) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({
    success: true,
    userId,
    token: 'demo-token-' + Date.now(),
  });
};
