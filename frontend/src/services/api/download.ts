/**
 * Authenticated file download. Export endpoints (FR-TP-003, FR-REP-005/006)
 * stream a file behind the Bearer token, so we fetch as a blob through the
 * axios client (which attaches auth + correlation id) then save it client-side.
 */
import { http } from './client';

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await http.get(path, { responseType: 'blob' });
  const blob = res.data as Blob;

  let filename = fallbackName;
  const disposition = res.headers['content-disposition'];
  if (typeof disposition === 'string') {
    const match = /filename="?([^"]+)"?/.exec(disposition);
    if (match?.[1]) filename = match[1];
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
