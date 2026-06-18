import React, { forwardRef } from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "brand" | "info" | "success" | "warning" | "danger";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = "", variant = "neutral", children, ...props }, ref) => {
    const baseStyles = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border";
    
    const variants = {
      neutral: "bg-surface-hover text-text-secondary border-border-strong",
      brand: "bg-brand-subtle text-brand border-brand/20",
      info: "bg-info-subtle text-info border-info/20",
      success: "bg-success-subtle text-success border-success/20",
      warning: "bg-warning-subtle text-warning border-warning/20",
      danger: "bg-danger-subtle text-danger border-danger/20",
    };

    return (
      <span
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
