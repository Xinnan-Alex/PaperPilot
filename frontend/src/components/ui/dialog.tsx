import * as React from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";

import { cn } from "@/lib/utils";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>,
) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-40 bg-black/50 transition-opacity",
        className,
      )}
      {...props}
    />
  );
}

type DialogSide = "left" | "right" | "center";

function DialogContent({
  className,
  children,
  side = "center",
  title,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: DialogSide;
  /** Accessible title — shown visually for center dialogs, hidden for drawers unless you pass a visible heading inside. */
  title?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-side={side}
        className={cn(
          "fixed z-50 bg-background outline-none focus:outline-none",
          side === "left" && [
            "inset-y-0 left-0 h-svh border-r border-border bg-sidebar-background",
          ],
          side === "right" && [
            "inset-y-0 right-0 h-svh border-l border-border bg-sidebar-background",
          ],
          side === "center" && [
            "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border shadow-[0_8px_22px_rgba(0,0,0,0.12)] p-6",
            "w-full max-w-md",
          ],
          className,
        )}
        {...props}
      >
        {/* Always provide an accessible title so Radix Dialog doesn't warn. */}
        {title ? (
          side === "center" ? (
            <DialogPrimitive.Title
              data-slot="dialog-title"
              className="text-base font-semibold text-foreground mb-1"
            >
              {title}
            </DialogPrimitive.Title>
          ) : (
            <VisuallyHidden.Root>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            </VisuallyHidden.Root>
          )
        ) : (
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Dialog</DialogPrimitive.Title>
          </VisuallyHidden.Root>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
};
