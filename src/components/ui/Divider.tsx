import React, { forwardRef } from "react";

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
}

export const Divider = forwardRef<HTMLHRElement, DividerProps>(
  ({ className = "", orientation = "horizontal", ...props }, ref) => {
    return (
      <hr
        ref={ref}
        className={`shrink-0 bg-border border-0 ${
          orientation === "horizontal" ? "h-px w-full" : "h-full w-px"
        } ${className}`}
        {...props}
      />
    );
  }
);

Divider.displayName = "Divider";
