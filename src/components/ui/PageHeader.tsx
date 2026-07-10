"use client";
import Link from "next/link";

interface PageHeaderProps {
  title: string;
  backHref?: string;
  backLabel?: string;
  right?: React.ReactNode;
  center?: React.ReactNode;
}

export function PageHeader({ title, backHref = "/", backLabel = "لابی", right, center }: PageHeaderProps) {
  return (
    <header className="page-header">
      {backHref ? (
        <Link href={backHref} className="btn btn-ghost page-back">
          <span aria-hidden>→</span>
          {backLabel}
        </Link>
      ) : (
        <span className="page-back-spacer" aria-hidden />
      )}
      {center ?? <h1 className="page-title">{title}</h1>}
      {right ?? <span className="page-back-spacer" aria-hidden />}
    </header>
  );
}
