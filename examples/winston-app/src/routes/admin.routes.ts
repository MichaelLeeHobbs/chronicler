/**
 * Admin routes
 */

import { Router } from 'express';

import { loginAttempt, performAdminAction } from '../controllers/admin.controller.js';

const router: Router = Router();

router.post('/action', performAdminAction);
router.post('/login', loginAttempt);

export default router;
