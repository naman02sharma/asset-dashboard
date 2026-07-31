import { Router } from 'express';
import {
  listPurchases,
  getPurchaseSummary,
  getPurchaseHistory,
  getCompletedOrders,
  exportPurchases,
  exportCompletedOrders,
  createPurchase,
  createPurchaseOrder,
  updatePurchase,
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
  approvePurchase,
  getNextPoNumber,
  searchByPoNumber,
} from '../controllers/purchaseController.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, requireAdminOrSenior } from '../middleware/auth.js';
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

// Preview-only PO number generator for the "Generate PO" button —
// fixed path, registered above /:id for the same reason as the
// other fixed paths in this block.
router.get('/next-po', asyncHandler(getNextPoNumber));
router.get('/search-po', asyncHandler(searchByPoNumber));

router.get('/', asyncHandler(listPurchases));
router.post('/', asyncHandler(createPurchase));
// Multi-item purchase — several line items, one vendor/order, grouped
// by a shared purchase_order_id. Registered as a fixed path (not
// "/:id"-shaped), same reasoning as summary/spend-trend/etc. above.
router.post('/batch', asyncHandler(createPurchaseOrder));

// General edit of a purchase's own fields (item name, vendor, quantity,
// unit cost, dates, PO number, etc.) — open to every authenticated
// role (admin/senior/employee), distinct from the narrower
// single-purpose PATCHes below (status/advance-payment/insurance/
// maintenance), each of which keeps its own endpoint and its own
// validation/log.
router.patch('/:id', asyncHandler(updatePurchase));

// Approve/reject a purchase pending review (see
// database/018_asset_approval_workflow.sql) — admins and seniors
// only. Every new purchase starts pending regardless of who created
// it, including an admin's own — nobody is auto-approved.
router.patch('/:id/approve', requireAdminOrSenior, asyncHandler(approvePurchase));

router.patch('/:id/status', asyncHandler(updatePurchaseStatus));
router.patch('/:id/record-delivery', asyncHandler(recordPartialDelivery));
router.patch('/:id/delivery-date', asyncHandler(updateDeliveryDate));
router.patch('/:id/restore', requireAdmin, asyncHandler(restorePurchase));
router.patch('/:id/insurance', asyncHandler(updateInsuranceStatus));
router.patch('/:id/advance-payment', asyncHandler(updateAdvancePayment));
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
