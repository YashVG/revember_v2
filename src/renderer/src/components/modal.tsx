import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./useDialogFocus";

export function Modal({ title, icon, className = "", closeOnBackdrop = true, onClose, children }: {
  title: string;
  icon: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useDialogFocus(onClose);
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  }}>
    <section ref={dialog.ref} onKeyDown={dialog.onKeyDown} className={`settings-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
      <DialogHeader title={title} icon={icon} onClose={onClose} />
      {children}
    </section>
  </div>;
}

function DialogHeader({ title, icon, onClose }: { title: string; icon: ReactNode; onClose: () => void }) {
  return <header>
    <div>{icon}<h2>{title}</h2></div>
    <button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X /></button>
  </header>;
}
