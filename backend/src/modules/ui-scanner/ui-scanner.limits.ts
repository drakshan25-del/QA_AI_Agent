/**
 * Hard limits for the UI Scanner (FR-UIS-023).
 *
 * Every one of these is a stop, not a suggestion: the scanner drives a real
 * browser against a user-supplied URL, so unbounded work is a denial-of-service
 * on the engine host. The engine enforces its own copies of the scan-shape
 * limits (`engine/uiscanner/types.py`); these are the backend's, which also
 * cover queueing and storage.
 */

/** Concurrent scans across the whole backend. */
export const MAX_GLOBAL_CONCURRENT_SCANS = Number(
  process.env.UI_SCAN_MAX_CONCURRENT || 2,
);

/** Concurrent scans per project, so one project cannot starve the others. */
export const MAX_PROJECT_CONCURRENT_SCANS = Number(
  process.env.UI_SCAN_MAX_CONCURRENT_PER_PROJECT || 1,
);

/** Scans a user may start per project per minute (rate limit). */
export const MAX_SCANS_PER_MINUTE = Number(process.env.UI_SCAN_RATE_PER_MINUTE || 6);

export const DEFAULT_TIMEOUT_MS = Number(process.env.UI_SCAN_TIMEOUT_MS || 45_000);
export const MAX_TIMEOUT_MS = Number(process.env.UI_SCAN_MAX_TIMEOUT_MS || 300_000);
export const MIN_TIMEOUT_MS = 5_000;

export const DEFAULT_MAX_ELEMENTS = Number(process.env.UI_SCAN_MAX_ELEMENTS || 250);
export const MAX_MAX_ELEMENTS = Number(process.env.UI_SCAN_ELEMENT_CEILING || 1_000);

/** Pages one crawl may visit. Crawling is opt-in; the default scans one page. */
export const DEFAULT_MAX_PAGES = 1;
export const MAX_MAX_PAGES = Number(process.env.UI_SCAN_PAGE_CEILING || 25);

/** Largest screenshot stored per scan. */
export const MAX_SCREENSHOT_BYTES = Number(
  process.env.UI_SCAN_MAX_SCREENSHOT_BYTES || 8 * 1024 * 1024,
);

/** Watchdog margin over the scan timeout before the backend gives up on the
 * engine stream and settles the scan itself. */
export const STREAM_WATCHDOG_MARGIN_MS = 60_000;

/**
 * Allow scanning private/loopback addresses. Off by default; a fully local
 * development stack (target app on localhost) turns it on explicitly.
 */
export const ALLOW_PRIVATE_NETWORK =
  (process.env.UI_SCAN_ALLOW_PRIVATE_NETWORK || 'false').toLowerCase() === 'true';

/** Default bar for the bulk "approve high confidence" action. */
export const DEFAULT_APPROVAL_CONFIDENCE = 0.9;
