import { Router } from 'express';
import { register, login, getCurrentUser, updateNotificationSettings, forgotPassword, resetPassword, listUsers, updateUserRole, updateUserApproval } from '../controllers/authController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/forgot-password', asyncHandler(forgotPassword));
router.post('/reset-password', asyncHandler(resetPassword));
router.get('/me', authenticateToken, asyncHandler(getCurrentUser));
router.patch('/notification-settings', authenticateToken, asyncHandler(updateNotificationSettings));
router.get('/users', authenticateToken, requireAdmin, asyncHandler(listUsers));
router.patch('/users/:id/role', authenticateToken, requireAdmin, asyncHandler(updateUserRole));
router.patch('/users/:id/approval', authenticateToken, requireAdmin, asyncHandler(updateUserApproval));

export default router;
