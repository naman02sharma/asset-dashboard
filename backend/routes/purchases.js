import { Router } from 'express';
import {
  listPurchases,
  getPurchaseSummary,
  getPurchaseHistory,
  getCompletedOrders,
  exportPurchases,
  exportCompletedOrders,
  createPurchase,
  updatePurchaseStatus,
  updateDeliveryDate,
  recordPayment,
  updateAdvancePayment,
  deletePurchase,
  restorePurchase,
  updateInsuranceStatus,
  saveInsurancePhotos,
  saveInvoiceFiles,
  deletePurchaseFile,
  scheduleMaintenance,
  completeMaintenance,
  getPurchaseAudit,
  getSpendTrend,
  getPurchasesByMonth,
  recordPartialDelivery,
} from '../controllers/purchaseController.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadInsurancePhotos, uploadInvoiceFiles } from '../middleware/upload.js';

const router = Router();

// --- Fixed-path routes MUST be registered before /:id routes, or
// Express would try to match "summary"/"history"/"completed" as a
// purchase id and fail the ::uuid cast in the controller. ---
router.get('/summary', asyncHandler(getPurchaseSummary));
router.get('/spend-trend', asyncHandler(getSpendTrend));
router.get('/by-month', asyncHandler(getPurchasesByMonth));
router.get('/history', asyncHandler(getPurchaseHistory));
router.get('/export', asyncHandler(exportPurchases));
router.get('/completed/export', asyncHandler(exportCompletedOrders));
router.get('/completed', asyncHandler(getCompletedOrders));

router.get('/', asyncHandler(listPurchases));
router.post('/', asyncHandler(createPurchase));

router.patch('/:id/status', asyncHandler(updatePurchaseStatus));
router.patch('/:id/record-delivery', asyncHandler(recordPartialDelivery));
router.patch('/:id/delivery-date', asyncHandler(updateDeliveryDate));
router.patch('/:id/restore', requireAdmin, asyncHandler(restorePurchase));
router.patch('/:id/insurance', asyncHandler(updateInsuranceStatus));
router.patch('/:id/advance-payment', requireAdmin, asyncHandler(updateAdvancePayment));
router.patch('/:id/maintenance', asyncHandler(scheduleMaintenance));
router.patch('/:id/maintenance/complete', asyncHandler(completeMaintenance));
router.get('/:id/audit', asyncHandler(getPurchaseAudit));

router.post('/:id/payments', asyncHandler(recordPayment));

// Multipart uploads — multer parses req.files before the handler runs.
router.post('/:id/insurance-photos', uploadInsurancePhotos, asyncHandler(saveInsurancePhotos));
router.post('/:id/invoices', uploadInvoiceFiles, asyncHandler(saveInvoiceFiles));
router.delete('/:id/files/:fileId', requireAdmin, asyncHandler(deletePurchaseFile));

// DELETE /:id?mode=permanent|history (default: history — soft delete) — admin-only either way.
router.delete('/:id', requireAdmin, asyncHandler(deletePurchase));

export default router;
