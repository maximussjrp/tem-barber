import React, { forwardRef } from "react";
import { Button, ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children"> {
  icon: React.ReactNode;
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, className = "", ...props }, ref) => {
    return (
      <Button ref={ref} size="icon" className={`rounded-full ${className}`} {...props}>
        {icon}
      </Button>
    );
  }
);

IconButton.displayName = "IconButton";
