import { Router } from 'express';
import { listEmployees, createEmployee, deactivateEmployee } from '../controllers/employeeController.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(listEmployees));
router.post('/', asyncHandler(createEmployee));
// BUGFIX (uniformity audit): deactivating an employee record is the
// same kind of "remove/retire" action as retiring an asset
// (PATCH /assets/:id/status) or revoking a user's access
// (PATCH /auth/users/:id/approval) — both of those are admin-only, this
// wasn't. Not currently wired to any frontend UI (no live exploit path
// through the app today), but fixed for consistency and to close the
// gap before something does call it.
router.patch('/:id/deactivate', asyncHandler(deactivateEmployee));

export default router;
