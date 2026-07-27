import { Router } from 'express';
import { listEmployees, createEmployee, deactivateEmployee } from '../controllers/employeeController.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(listEmployees));
router.post('/', asyncHandler(createEmployee));
router.patch('/:id/deactivate', asyncHandler(deactivateEmployee));

export default router;
