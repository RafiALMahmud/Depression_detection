interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  isProcessing?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmationDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  isProcessing = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="mw-modal-overlay">
      <div className="mw-modal-card" style={{ maxWidth: '520px' }}>
        <h3 className="mw-modal-title">{title}</h3>
        <p className="mw-entity-description">{message}</p>
        <div className="mw-modal-actions" style={{ marginTop: '18px' }}>
          <button type="button" onClick={onCancel} className="mw-btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={isProcessing} className="mw-btn-danger">
            {isProcessing ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
