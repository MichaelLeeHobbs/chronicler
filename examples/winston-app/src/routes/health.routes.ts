/**
 * Health check routes
 */

import { Router } from 'express';

import { healthCheck, healthDeep } from '../controllers/health.controller.js';

const router: Router = Router();

router.get('/', healthCheck);
router.get('/deep', healthDeep);

export default router;
