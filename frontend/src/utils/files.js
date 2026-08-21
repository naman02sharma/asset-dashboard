export const PDF_EXT = /\.pdf$/i;

export function isPdfFile(name) {
  return PDF_EXT.test(name || '');
}

/**
 * Click handler for an uploaded file row. Always opens the in-app
 * centered preview modal (FilePreviewModal) — for every file type,
 * including PDFs. FilePreviewModal itself carries Download and Print
 * actions in its header, so there's no need to hand off to a bare
 * new browser tab (which used to be the PDF-only behavior here) just
 * to get those controls.
 */
export function openOrPreviewFile(file, setPreviewFile) {
  setPreviewFile(file);
}