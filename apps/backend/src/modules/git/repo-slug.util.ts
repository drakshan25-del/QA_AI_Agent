/**
 * Accepts 'owner/repo', 'https://github.com/owner/repo(.git)' or
 * 'git@github.com:owner/repo.git' and returns the canonical 'owner/repo'
 * slug, or null when the value cannot be interpreted as a GitHub repo.
 * The GitHub REST API and git remote URLs are both built from the slug,
 * so it is the single stored format (see ProjectsService).
 */
export function normalizeRepoSlug(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;
  value = value
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? value : null;
}
