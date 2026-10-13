import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  body: string;
  /** What the button that does it says. */
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A question with two answers, for something that cannot be undone.
 *
 * Cancel holds the focus, so Enter — the key most likely to be hit without
 * reading — keeps things as they are, and so do Escape and a click outside.
 * The answer that does the damage takes a deliberate click, or a Tab first.
 */
export function ConfirmDialog({ title, body, confirm, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div
        className="modal confirm"
        role="alertdialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button className="ghost-button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost-button danger" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
