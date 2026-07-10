"use client";
import { useRef } from "react";
import { useModalLock } from "./useModalLock";
import { useFocusTrap } from "./useFocusTrap";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  titleId?: string;
  className?: string;
}

export function Modal({ title, subtitle, onClose, children, titleId = "modal-title", className = "" }: ModalProps) {
  useModalLock(onClose);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className={`modal-card panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId} className="modal-title">{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="بستن">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
