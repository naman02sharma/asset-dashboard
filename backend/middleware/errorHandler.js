import multer from 'multer';

// Wraps async route handlers so thrown errors/rejected promises are
// forwarded to Express's error handler instead of crashing the process.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Centralized error handler — register last in server.js.
//
// File-upload fallback (dry-run note): a rejected file type or an
// over-limit file surfaces here as either a MulterError (size/count
// limits) or a plain Error thrown from upload.js's fileFilter (wrong
// mimetype). Both are the USER's mistake, not a server fault — without
// this check they'd fall through to the generic 500 branch below and
// look like a crash instead of "please pick a smaller/different file".
export function errorHandler(err, req, res, next) {
  console.error(err);

  if (err instanceof multer.MulterError) {
    const friendly = err.code === 'LIMIT_FILE_SIZE'
      ? 'One of the selected files is over the 10MB limit.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
      ? 'Too many files selected — up to 10 at a time.'
      : err.message;
    return res.status(400).json({ error: friendly });
  }

  // upload.js's fileFilter throws a plain Error (not a MulterError) for
  // an unsupported file type — its .message is already user-facing.
  if (err.message?.includes('only JPEG, PNG, or PDF are allowed')) {
    return res.status(400).json({ error: err.message });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error.',
  });
}
