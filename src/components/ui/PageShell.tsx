"use client";

interface PageShellProps {
  children: React.ReactNode;
  wide?: boolean;
  table?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function PageShell({ children, wide, table, className = "", style }: PageShellProps) {
  const base = table ? "table-shell" : wide ? "page-shell page-shell--wide" : "page-shell";
  return <main className={`${base} ${className}`.trim()} style={style}>{children}</main>;
}
