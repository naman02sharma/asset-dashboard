import { Router } from 'express';
import { getPublicAssetPage } from '../controllers/publicController.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// Deliberately NOT behind authenticateToken — see publicController.js
// for why this page is meant to be open.
router.get('/asset/:id', asyncHandler(getPublicAssetPage));

export default router;
