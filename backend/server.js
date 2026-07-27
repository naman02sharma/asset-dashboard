import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import purchaseRoutes from './routes/purchases.js';
import vendorRoutes from './routes/vendors.js';
import locationRoutes from './routes/locations.js';
import notificationRoutes from './routes/notifications.js';
import authRoutes from './routes/auth.js';
import assetRoutes from './routes/assets.js';
import employeeRoutes from './routes/employees.js';
import publicRoutes from './routes/public.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';
import { UPLOAD_ROOT } from './middleware/upload.js';
import { scheduleAutomationJobs } from './services/trackingService.js';

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// Serves uploaded insurance photos/invoices, e.g.
// GET /uploads/insurance-photos/<file>.jpg — the DB only stores this
// relative path (see middleware/upload.js -> publicPathFor).
app.use('/uploads', express.static(UPLOAD_ROOT));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Public: account creation/login don't require a token yet.
app.use('/api/auth', authRoutes);

// Public: courier webhooks are called by the courier's servers, not a
// logged-in user — protect this with a shared secret/IP allowlist in
// production instead of a user JWT.
app.use('/api/webhooks', notificationRoutes);

// Public: scanned from a physical asset's QR code — see
// controllers/publicController.js for why this stays open.
app.use('/public', publicRoutes);

// Everything below requires a logged-in user.
app.use('/api/purchases', authenticateToken, purchaseRoutes);
app.use('/api/vendors', authenticateToken, vendorRoutes);
app.use('/api/locations', authenticateToken, locationRoutes);
app.use('/api/assets', authenticateToken, assetRoutes);
app.use('/api/employees', authenticateToken, employeeRoutes);

// Must be registered after all routes.
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Asset dashboard API listening on port ${PORT}`);
  scheduleAutomationJobs(); // daily overdue-delivery / payment-due checks
});
