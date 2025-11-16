/**
 * User controller - Demo CRUD operations
 */

import type { Request, Response } from 'express';

import { business } from '../events.js';
import { chronicleMain } from '../services/chronicler.js';

// Mock user data store
const users = new Map<string, { id: string; email: string; name: string }>();

export const getUsers = (_req: Request, res: Response) => {
  res.json({
    users: Array.from(users.values()),
    count: users.size,
  });
};

export const getUser = (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  const user = users.get(id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
};

export const createUser = (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' });
  }

  const id = `user-${Date.now()}`;
  const user = { id, email, name };
  users.set(id, user);

  // Log business event
  chronicleMain.event(business.events.userCreated, {
    userId: id,
    email,
  });

  res.status(201).json(user);
};

export const deleteUser = (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  const existed = users.delete(id);

  if (!existed) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.status(204).send();
};
