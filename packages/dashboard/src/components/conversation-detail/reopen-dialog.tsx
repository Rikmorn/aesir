"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ReopenDialogProps {
  conversationId: string;
  status: string;
  onReopened: () => void;
}

export function ReopenDialog({
  conversationId,
  status,
  onReopened,
}: ReopenDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = status === "failed" ? "Retry" : "Reopen";
  const placeholder =
    status === "failed"
      ? "What was fixed that should allow this to succeed now?"
      : "What changed since this conversation completed?";

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/dashboard/api/conversations/${conversationId}/reopen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(
          body?.error ?? `Failed to ${label.toLowerCase()} conversation`,
        );
        return;
      }

      setOpen(false);
      setReason("");
      setError(null);
      onReopened();
    } catch {
      setError("Network error -- could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCcw className="h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} Conversation</DialogTitle>
          <DialogDescription>
            The agent will resume with awareness of its previous run. Provide
            context about what changed.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason.trim() || submitting}
          >
            {submitting ? `${label}ing...` : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
