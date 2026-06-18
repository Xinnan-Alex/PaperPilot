import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  Button,
} from "paperpilot";

// Centered modal dialog, shown open. `title` renders a visible heading for
// center dialogs; the body composes its own content and footer actions.
export function RenameChat() {
  return (
    <Dialog defaultOpen>
      <DialogContent side="center" title="Rename chat">
        <DialogDescription>
          Give this conversation a name so it's easy to find later.
        </DialogDescription>
        <input
          defaultValue="Q3 revenue analysis"
          className="mt-4 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Save</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
