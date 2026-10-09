"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Body layout: scroll (default) or fill remaining height for embedded editors. */
  bodyClassName?: string;
  size?: "default" | "wide" | "xl" | "fullscreen";
};

const sizeClass = {
  default: "sm:max-w-lg",
  wide: "sm:max-w-3xl",
  xl: "sm:max-w-6xl w-[min(96vw,72rem)]",
  fullscreen: "sm:max-w-5xl",
};

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
  size = "default",
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-3 p-4",
          sizeClass[size],
          className,
        )}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <DialogFooter className="shrink-0">{footer}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
