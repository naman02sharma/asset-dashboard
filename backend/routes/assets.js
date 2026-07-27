import { Router } from 'express';
import {
  listAssets,
  getAssetSummaryCounts,
  exportAssets,
  importAssets,
  getAssetDetail,
  createAsset,
  updateAsset,
  assignToEmployee,
  dispatchToMaintenance,
  returnAsset,
  setAssetStatus,
  saveAmcContracts,
  saveAmcInvoices,
  deleteAssetFile,
  deleteAsset,
  getCalendarEvents,
  getAssetQrCode,
} from '../controllers/assetController.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadAssetFiles } from '../middleware/upload.js';

const router = Router();

// --- Fixed-path routes MUST be registered before /:id routes — see
// the same note in routes/purchases.js. ---
router.get('/summary', asyncHandler(getAssetSummaryCounts));
router.get('/calendar', asyncHandler(getCalendarEvents));
router.get('/export', asyncHandler(exportAssets));
router.post('/import', requireAdmin, asyncHandler(importAssets));

router.get('/', asyncHandler(listAssets));
router.post('/', asyncHandler(createAsset));

router.get('/:id', asyncHandler(getAssetDetail));
router.get('/:id/qrcode', asyncHandler(getAssetQrCode));
router.patch('/:id', requireAdmin, asyncHandler(updateAsset));
router.delete('/:id', requireAdmin, asyncHandler(deleteAsset));

router.post('/:id/assign', asyncHandler(assignToEmployee));
router.post('/:id/dispatch-repair', asyncHandler(dispatchToMaintenance));
router.patch('/:id/return', asyncHandler(returnAsset));
router.patch('/:id/status', requireAdmin, asyncHandler(setAssetStatus));

router.post('/:id/amc-contracts', uploadAssetFiles, asyncHandler(saveAmcContracts));
router.post('/:id/amc-invoices', uploadAssetFiles, asyncHandler(saveAmcInvoices));
router.delete('/:id/files/:fileId', requireAdmin, asyncHandler(deleteAssetFile));

export default router;
