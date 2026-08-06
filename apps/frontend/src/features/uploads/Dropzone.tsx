import { useRef, useState, type DragEvent } from 'react';
import s from './uploads.module.css';

/** Accessible drag-and-drop + click-to-browse file picker (FR-IN-007). */
export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`${s.dropzone} ${dragging ? s.dropzoneActive : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload files: drag and drop or press Enter to browse"
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="visually-hidden"
        accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.json"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <div className={s.dropIcon} aria-hidden="true">
        ⬆
      </div>
      <div className={s.dropTitle}>Drag &amp; drop documents here</div>
      <div className={s.dropHint}>
        or click to browse · PDF, DOCX, TXT, MD, CSV, XLSX · up to 25&nbsp;MB each
      </div>
    </div>
  );
}
