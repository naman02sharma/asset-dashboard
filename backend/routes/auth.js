import { Router } from 'express';
import { register, login, logout, getCurrentUser, updateNotificationSettings, forgotPassword, resetPassword, listUsers, exportUsers, updateUserRole, updateUserApproval, updateEmployeeDetails, deleteUser } from '../controllers/authController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', authenticateToken, asyncHandler(logout));
router.post('/forgot-password', asyncHandler(forgotPassword));
router.post('/reset-password', asyncHandler(resetPassword));
router.get('/me', authenticateToken, asyncHandler(getCurrentUser));
router.patch('/notification-settings', authenticateToken, asyncHandler(updateNotificationSettings));
// Fixed path — must be registered before nothing in particular here
// (this router has no GET '/users/:id'), but kept next to '/users' for
// readability, same convention as purchases'/assets' own /export routes.
router.get('/users/export', authenticateToken, requireAdmin, asyncHandler(exportUsers));
router.get('/users', authenticateToken, requireAdmin, asyncHandler(listUsers));
router.patch('/users/:id/role', authenticateToken, requireAdmin, asyncHandler(updateUserRole));
router.patch('/users/:id/approval', authenticateToken, requireAdmin, asyncHandler(updateUserApproval));
router.patch('/users/:id/details', authenticateToken, requireAdmin, asyncHandler(updateEmployeeDetails));
router.delete('/users/:id', authenticateToken, requireAdmin, asyncHandler(deleteUser));

export default router;
