import type { ReactNode } from "react";
import { InlineError } from "./review-ui";
import { Modal } from "./modal";

type ConfirmationDialogProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  isConfirming: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmationDialog({
  title,
  icon,
  children,
  confirmLabel,
  pendingLabel,
  isConfirming,
  error,
  onConfirm,
  onClose
}: ConfirmationDialogProps) {
  return (
    <Modal title={title} icon={icon} className="confirm-dialog" closeOnBackdrop={false} onClose={onClose}>
      <div className="confirm-body">
        {children}
        {error && <InlineError message={error} />}
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="danger-button" disabled={isConfirming} onClick={onConfirm}>
            {isConfirming ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
