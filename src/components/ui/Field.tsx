"use client";

interface FieldProps {
  label: string;
  htmlFor?: string;
  counter?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, counter, children }: FieldProps) {
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={htmlFor}>
        <span>{label}</span>
        {counter && <span className="ui-counter">{counter}</span>}
      </label>
      {children}
    </div>
  );
}
