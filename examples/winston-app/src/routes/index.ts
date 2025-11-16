/**
 * Route aggregator
 */

import { Router } from 'express';

import adminRoutes from './admin.routes.js';
import healthRoutes from './health.routes.js';
import userRoutes from './user.routes.js';

const router: Router = Router();

// Mount routes
router.use('/health', healthRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);

export default router;
