"use client";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function Input({ className = "", ...props }: InputProps) {
  return <input className={`ui-input ${className}`.trim()} {...props} />;
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  className?: string;
};

export function Select({ className = "", children, ...props }: SelectProps) {
  return <select className={`ui-input ${className}`.trim()} {...props}>{children}</select>;
}
