/**
 * Thresholds for binding test steps to scanned locators (FR-UIS-025 §2, §5, §17).
 *
 * These are the knobs that decide when a stored locator is still trustworthy
 * and when the system must go back to the browser. Defaults are deliberately
 * conservative: an unnecessary re-validation costs a few seconds, a stale
 * locator costs a wrong test.
 */

/**
 * How long a passing validation is trusted before the locator is re-probed
 * (§5 "older than the configured freshness period"). Seven days by default —
 * long enough that generating a suite does not re-open a browser for every
 * step, short enough that a UI change surfaces within a sprint.
 */
export const LOCATOR_FRESHNESS_MS =
  Number(process.env.LOCATOR_FRESHNESS_HOURS || 24 * 7) * 3_600_000;

/** Lowest element-match confidence a deterministic match may be used at. */
export const MIN_ELEMENT_MATCH_CONFIDENCE = Number(
  process.env.LOCATOR_MIN_MATCH_CONFIDENCE || 0.55,
);

/** Lowest locator confidence a record may be generated from (§4). */
export const MIN_LOCATOR_CONFIDENCE = Number(
  process.env.LOCATOR_MIN_CONFIDENCE || 0.6,
);

/**
 * Bar an unapproved locator must clear to be used at priority 3 (§2.3).
 * Higher than the approved bar: nobody has reviewed it, so it has to be
 * unambiguous on its own merits.
 */
export const MIN_UNAPPROVED_LOCATOR_CONFIDENCE = Number(
  process.env.LOCATOR_MIN_UNAPPROVED_CONFIDENCE || 0.85,
);

/** Locators probed in one engine round trip (the engine's own cap is 50). */
export const REVALIDATION_BATCH_SIZE = 25;

/** Pages re-validated concurrently — one browser context each (§17). */
export const MAX_PARALLEL_REVALIDATION_PAGES = Number(
  process.env.LOCATOR_REVALIDATION_CONCURRENCY || 2,
);

/** Ceiling on locators re-validated for a single generation request. */
export const MAX_REVALIDATIONS_PER_REQUEST = Number(
  process.env.LOCATOR_MAX_REVALIDATIONS || 60,
);

/** How long a targeted rescan may hold up generation before it is abandoned. */
export const TARGETED_RESCAN_TIMEOUT_MS = Number(
  process.env.LOCATOR_RESCAN_TIMEOUT_MS || 180_000,
);

/** Poll interval while waiting for a targeted rescan to settle. */
export const TARGETED_RESCAN_POLL_MS = 2_000;

/** Scanned elements offered to the model in one grouped match request (§2.5). */
export const MAX_LLM_MATCH_ELEMENTS = 120;
