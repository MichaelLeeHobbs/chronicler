/**
 * User routes
 */

import { Router } from 'express';

import { createUser, deleteUser, getUser, getUsers } from '../controllers/user.controller.js';

const router: Router = Router();

router.get('/', getUsers);
router.get('/:id', getUser);
router.post('/', createUser);
router.delete('/:id', deleteUser);

export default router;
