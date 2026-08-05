import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, resolve, sep } from 'path';
import { NotFoundAppException } from '../../common/errors';
import { MAX_SCREENSHOT_BYTES } from './ui-scanner.limits';

/**
 * Scan artefact storage (FR-UIS-019, FR-UIS-020).
 *
 * Screenshots and ARIA snapshots are written under the backend's own upload
 * directory, one folder per project and scan. Two rules make the artefact
 * endpoints safe to expose:
 *
 * 1. the database stores only a *file name*, never a path — the directory is
 *    derived server-side from ids the caller has already been authorised for,
 *    so no backend filesystem path is ever exposed to the browser (§23);
 * 2. every read re-resolves the path and asserts it is still inside the scan's
 *    own directory, so a crafted id cannot traverse out of it.
 */
@Injectable()
export class UiScanArtifactsService {
  private readonly logger = new Logger(UiScanArtifactsService.name);

  static readonly SCREENSHOT_FILE = 'screenshot.png';
  static readonly SNAPSHOT_FILE = 'accessibility-snapshot.yaml';

  constructor(private readonly config: ConfigService) {}

  private get root(): string {
    return resolve(this.config.get<string>('uploadDir') || './evidence', 'ui-scans');
  }

  /** Directory of one scan's artefacts, derived from authorised ids only. */
  private scanDir(projectId: string, scanId: string): string {
    const dir = resolve(this.root, sanitiseId(projectId), sanitiseId(scanId));
    assertInside(this.root, dir);
    return dir;
  }

  /** Persist the base64 screenshot returned by the engine; '' when skipped. */
  async saveScreenshot(
    projectId: string,
    scanId: string,
    base64: string,
  ): Promise<string> {
    if (!base64) return '';
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_SCREENSHOT_BYTES) {
      this.logger.warn(
        `scan ${scanId}: screenshot rejected (${buffer.length} bytes)`,
      );
      return '';
    }
    return this.write(
      projectId,
      scanId,
      UiScanArtifactsService.SCREENSHOT_FILE,
      buffer,
    );
  }

  async saveAccessibilitySnapshot(
    projectId: string,
    scanId: string,
    snapshot: string,
  ): Promise<string> {
    if (!snapshot.trim()) return '';
    return this.write(
      projectId,
      scanId,
      UiScanArtifactsService.SNAPSHOT_FILE,
      Buffer.from(snapshot, 'utf8'),
    );
  }

  private async write(
    projectId: string,
    scanId: string,
    filename: string,
    data: Buffer,
  ): Promise<string> {
    const dir = this.scanDir(projectId, scanId);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, filename), data);
      return filename;
    } catch (err) {
      // An artefact is supporting evidence, not the scan result: a storage
      // failure is recorded as a warning, never a lost scan (§19).
      this.logger.warn(
        `scan ${scanId}: could not store ${filename}: ${(err as Error).message}`,
      );
      return '';
    }
  }

  /** Read an artefact for an already-authorised project + scan. */
  async read(
    projectId: string,
    scanId: string,
    filename: string,
  ): Promise<Buffer> {
    const dir = this.scanDir(projectId, scanId);
    const path = resolve(dir, filename);
    assertInside(dir, path);
    try {
      return await fs.readFile(path);
    } catch {
      throw new NotFoundAppException(
        'That scan artefact is no longer available. Re-run the scan to regenerate it.',
      );
    }
  }

  // --- authentication storage state (§16) ---------------------------------

  private storageStateDir(projectId: string): string {
    const dir = resolve(this.root, 'storage-states', sanitiseId(projectId));
    assertInside(this.root, dir);
    return dir;
  }

  /**
   * Ids of the storage states available to a project.
   *
   * Storage states are provisioned out of band by an administrator (a
   * Playwright `storageState` JSON dropped into the project's folder). The
   * scanner never accepts a filesystem path from the browser — only an id
   * that is resolved inside the project's own directory — so one project can
   * never reference another's session (§16 ownership + path traversal).
   */
  async listStorageStates(projectId: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.storageStateDir(projectId));
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Load a storage state for forwarding to the engine.
   *
   * The parsed contents are returned to the caller for exactly one purpose —
   * handing them to the engine's browser context. They are never logged,
   * never returned to the browser and never sent to a model.
   */
  async readStorageState(
    projectId: string,
    storageStateId: string,
  ): Promise<Record<string, unknown>> {
    const dir = this.storageStateDir(projectId);
    const path = resolve(dir, `${sanitiseId(storageStateId)}.json`);
    assertInside(dir, path);
    let raw: string;
    try {
      raw = await fs.readFile(path, 'utf8');
    } catch {
      throw new NotFoundAppException(
        `No authentication state "${storageStateId}" exists for this project.`,
      );
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new NotFoundAppException(
        `The authentication state "${storageStateId}" is not valid JSON and cannot be used.`,
      );
    }
  }

  /** Remove a scan's artefacts (rescan supersede / retention sweep). */
  async remove(projectId: string, scanId: string): Promise<void> {
    try {
      await fs.rm(this.scanDir(projectId, scanId), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `scan ${scanId}: artefact cleanup failed: ${(err as Error).message}`,
      );
    }
  }
}

/** Ids come from the database, but never build a path from unchecked text. */
function sanitiseId(id: string): string {
  const clean = (id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new NotFoundAppException('Invalid artefact identifier');
  return clean;
}

function assertInside(root: string, candidate: string): void {
  const normalisedRoot = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(normalisedRoot)) {
    throw new NotFoundAppException('Invalid artefact path');
  }
}
