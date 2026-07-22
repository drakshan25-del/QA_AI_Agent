import { useCallback, useRef, useState } from 'react';
import { documentsApi } from '../../services/api/endpoints';
import { ApiClientError } from '../../services/api/client';
import type { DocumentCategory } from '../../services/api/types';

export type UploadItemStatus =
  | 'queued'
  | 'uploading'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadItem {
  id: string;
  file: File;
  category: DocumentCategory;
  status: UploadItemStatus;
  progress: number;
  /** Server-reported parse status once uploaded (FR-IN-008). */
  parseStatus?: string;
  message?: string;
  error?: string;
  documentId?: string;
}

let seq = 0;
const nextId = () => `u${Date.now()}_${seq++}`;

/**
 * Client-side upload queue (FR-IN-007). Each file uploads as its own request so
 * progress, cancel and retry are per-file. Files are validated client-side for
 * size before hitting the network (the backend re-validates authoritatively,
 * FR-IN-010).
 */
export function useUploadQueue(projectId: string, onUploaded?: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  // Mirror of `items` for event handlers. Reading queue state by abusing a
  // setItems updater would run the side effect during render (twice under
  // StrictMode) and double-POST files.
  const itemsRef = useRef<UploadItem[]>(items);
  itemsRef.current = items;

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const addFiles = useCallback((files: File[], defaultCategory: DocumentCategory) => {
    const MAX = 25 * 1024 * 1024;
    setItems((prev) => [
      ...prev,
      ...files.map<UploadItem>((file) => ({
        id: nextId(),
        file,
        category: defaultCategory,
        status: file.size > MAX ? 'error' : 'queued',
        progress: 0,
        ...(file.size > MAX ? { error: 'File exceeds the 25 MB limit (FR-IN-010).' } : {}),
      })),
    ]);
  }, []);

  const setCategory = useCallback((id: string, category: DocumentCategory) => {
    patch(id, { category });
  }, [patch]);

  const removeItem = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      patch(item.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const res = await documentsApi.upload(
          projectId,
          [item.file],
          [item.category],
          (p) => patch(item.id, { progress: p }),
          controller.signal,
        );
        const doc = res.documents?.[0];
        patch(item.id, {
          status: 'done',
          progress: 100,
          parseStatus: doc?.parseStatus ?? doc?.parse_status ?? 'parsed',
          message: doc?.message,
          documentId: doc?.id,
        });
        onUploaded?.();
      } catch (err) {
        if (controller.signal.aborted) {
          patch(item.id, { status: 'cancelled' });
        } else {
          const message =
            err instanceof ApiClientError ? err.message : 'Upload failed. Please retry.';
          patch(item.id, { status: 'error', error: message });
        }
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [projectId, patch, onUploaded],
  );

  const uploadAll = useCallback(() => {
    for (const it of itemsRef.current) {
      if (it.status === 'queued') void uploadOne(it);
    }
  }, [uploadOne]);

  const retry = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      // Only failed/cancelled items are retryable — never re-POST an
      // in-flight or completed upload.
      if (it && (it.status === 'error' || it.status === 'cancelled')) {
        void uploadOne(it);
      }
    },
    [uploadOne],
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'done'));
  }, []);

  return {
    items,
    addFiles,
    setCategory,
    removeItem,
    uploadAll,
    retry,
    cancel,
    clearFinished,
  };
}
