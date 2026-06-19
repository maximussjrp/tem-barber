"use client";

import { useState } from "react";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  className?: string;
  fallbackText?: string;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
  xl: "w-16 h-16 text-lg",
  "2xl": "w-24 h-24 text-2xl",
  "3xl": "w-32 h-32 text-4xl",
};

export function Avatar({ src, alt = "", size = "md", className = "", fallbackText }: AvatarProps) {
  const [error, setError] = useState(false);

  // Extrair iniciais
  const initials = (fallbackText || alt)
    .split(" ")
    .filter((n) => n.length > 0)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const classes = `relative shrink-0 rounded-full flex items-center justify-center bg-stone-800 text-stone-300 font-bold overflow-hidden ${sizeClasses[size]} ${className}`;

  if (!src || error) {
    return (
      <div className={classes} title={alt}>
        {initials || "?"}
      </div>
    );
  }

  return (
    <div className={classes} title={alt}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        onError={() => setError(true)}
      />
    </div>
  );
}
