// =====================================================================
// upload.js
// Multi-file upload handling for insurance photos and invoices.
//
// Design (dry-run notes):
//  - multer uses MEMORY storage (not diskStorage) because images need
//    to be compressed with sharp BEFORE they're written to disk —
//    diskStorage writes the raw upload straight to a file, which would
//    mean compressing = read it back, resize, rewrite. Memory storage
//    lets processAndSaveFile() do resize-then-write in one pass. This
//    is safe at the enforced 10MB-per-file limit; it would need
//    revisiting (streaming to disk) if that limit were raised a lot.
//  - fileFilter THROWS a descriptive error for a rejected type/size,
//    rather than silently accepting 0 files — a silent drop looks like
//    a bug ("I picked a file and nothing happened"); an error message
//    the frontend can display is the honest failure mode.
//  - Each file is processed independently in processAndSaveFile, and
//    the controller (purchaseController.js) wraps each one in its own
//    try/catch — so if file 2 of 5 fails (bad compression, disk full,
//    etc.), files 1/3/4/5 still save and the response reports exactly
//    which one(s) failed instead of losing everything.
//  - Compression failure (e.g. a corrupt JPEG sharp can't parse) falls
//    back to saving the ORIGINAL buffer unmodified rather than
//    rejecting the upload — better to store an uncompressed file than
//    to lose it entirely.
// =====================================================================
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';

const UPLOAD_ROOT = path.resolve('uploads');

for (const sub of ['insurance-photos', 'invoices', 'asset-files']) {
  fs.mkdirSync(path.join(UPLOAD_ROOT, sub), { recursive: true });
}

// Scope matches the spec exactly: JPEG/PNG images, or PDF documents.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const DOCUMENT_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES_PER_REQUEST = 10;

function fileFilterFor(allowedTypes) {
  return (req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) {
      cb(new Error(`"${file.originalname}" is a ${file.mimetype || 'unknown'} file — only JPEG, PNG, or PDF are allowed.`));
      return;
    }
    cb(null, true);
  };
}

const memoryUpload = (allowedTypes) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_REQUEST },
  fileFilter: fileFilterFor(allowedTypes),
});

// Route middleware — parses the multipart body into req.files (an
// array of { buffer, originalname, mimetype, size }), ready for
// processAndSaveFile() to compress + write to disk in the controller.
// Insurance accepts the same document types as invoices (JPEG/PNG/PDF)
// — a scanned insurance policy is just as often a PDF as a photo.
export const uploadInsurancePhotos = memoryUpload(DOCUMENT_TYPES).array('photos', MAX_FILES_PER_REQUEST);
export const uploadInvoiceFiles = memoryUpload(DOCUMENT_TYPES).array('invoices', MAX_FILES_PER_REQUEST);

// Single-file variant for the "Upload invoice to auto-fill" button on
// New Purchase — extraction reads exactly one document, so this is
// .single() rather than the .array() every other upload here uses.
export const uploadInvoiceForExtraction = memoryUpload(DOCUMENT_TYPES).single('invoice');

// Inventory module — AMC contracts and their invoices. Both accept the
// same document types (image or PDF); they land in the same
// 'asset-files' disk subfolder and are distinguished in the DB by
// `kind` ('amc_contract' | 'amc_invoice'), not by folder.
export const uploadAssetFiles = memoryUpload(DOCUMENT_TYPES).array('files', MAX_FILES_PER_REQUEST);

/**
 * Compresses (images only) and writes one uploaded file to disk.
 * Returns { publicPath, originalName, mimeType, sizeBytes } — the
 * shape purchaseController.js inserts straight into purchase_files.
 *
 * Never throws for a compression failure — falls back to the original
 * buffer so a single unusual file can't break the whole upload.
 */
export async function processAndSaveFile(file, subfolder) {
  const ext = file.mimetype === 'application/pdf' ? '.pdf' : (path.extname(file.originalname) || '.jpg');
  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const destPath = path.join(UPLOAD_ROOT, subfolder, safeName);

  let bufferToWrite = file.buffer;

  if (IMAGE_TYPES.has(file.mimetype)) {
    try {
      // Resize to a sane max dimension and re-encode at quality 80 —
      // meaningfully smaller on disk for typical phone-camera photos
      // without a visible quality loss at the sizes this app displays
      // images (thumbnails / a lightbox), while never upscaling a
      // smaller source image (withoutEnlargement).
      bufferToWrite = await sharp(file.buffer)
        .rotate() // respects the image's EXIF orientation before resizing
        .resize({ width: 1920, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (err) {
      console.warn(`Image compression failed for "${file.originalname}", saving original instead:`, err.message);
      bufferToWrite = file.buffer;
    }
  }

  await fs.promises.writeFile(destPath, bufferToWrite);

  return {
    publicPath: publicPathFor(subfolder, safeName),
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: bufferToWrite.length,
  };
}

// Public URL path (relative) stored in the DB and returned to the
// frontend — kept separate from the disk path so moving UPLOAD_ROOT
// later doesn't require a data migration.
export function publicPathFor(subfolder, filename) {
  return `/uploads/${subfolder}/${filename}`;
}

export { UPLOAD_ROOT, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST };
