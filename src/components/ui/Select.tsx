import React, { forwardRef } from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, error, helperText, id, options, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id || generatedId;
    const helperId = `${selectId}-helper`;
    const errorId = `${selectId}-error`;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={selectId} className="label text-text-secondary">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={`${error ? errorId : ""} ${helperText ? helperId : ""}`.trim() || undefined}
          className={`
            flex h-11 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text-primary 
            transition-colors focus-visible:outline-none focus-visible:ring-2 
            focus-visible:ring-brand focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50
            ${error ? "border-danger focus-visible:ring-danger focus-visible:border-danger" : "border-border-strong"}
            ${className}
          `}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-sm text-text-muted">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
