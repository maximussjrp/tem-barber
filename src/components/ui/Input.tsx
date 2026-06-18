import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, helperText, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="label text-text-secondary">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={`${error ? errorId : ""} ${helperText ? helperId : ""}`.trim() || undefined}
          className={`
            flex h-11 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text-primary 
            transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium
            placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 
            focus-visible:ring-brand focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50
            ${error ? "border-danger focus-visible:ring-danger focus-visible:border-danger" : "border-border-strong"}
            ${className}
          `}
          {...props}
        />
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

Input.displayName = "Input";
