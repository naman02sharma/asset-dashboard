export const PDF_EXT = /\.pdf$/i;

export function isPdfFile(name) {
  return PDF_EXT.test(name || '');
}

/**
 * Click handler for an uploaded file row. PDFs open in a real new
 * browser tab (the browser's native PDF viewer, which already has
 * print/download controls built into its toolbar) instead of the
 * in-app centered iframe popup — the popup version had no room for
 * print/download and felt like a dead end. Everything else (images,
 * unrecognized types) keeps using the in-app preview modal, which
 * still has its own "Open in new tab" button for anything without an
 * inline preview.
 */
export function openOrPreviewFile(file, setPreviewFile) {
  if (isPdfFile(file.name)) {
    window.open(file.url, '_blank', 'noopener,noreferrer');
  } else {
    setPreviewFile(file);
  }
}