import { Ban, CircleAlert, CircleCheck, CircleDashed, Clock, Loader2, ShieldAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { copy } from "../strings";
import type { ItemStatus } from "../types/queue";

const CONFIG: Record<ItemStatus, { label: string; variant: ComponentProps<typeof Badge>["variant"]; Icon: typeof Clock }> = {
  ready: { label: copy.status.ready, variant: "outline", Icon: CircleDashed },
  invalid: { label: copy.status.invalid, variant: "destructive", Icon: Ban },
  queued: { label: copy.status.queued, variant: "secondary", Icon: Clock },
  processing: { label: copy.status.processing, variant: "secondary", Icon: Loader2 },
  success: { label: copy.status.success, variant: "success", Icon: CircleCheck },
  partial: { label: copy.status.partial, variant: "warning", Icon: ShieldAlert },
  failed: { label: copy.status.failed, variant: "destructive", Icon: CircleAlert },
  cancelled: { label: copy.status.cancelled, variant: "outline", Icon: Ban },
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  const { label, variant, Icon } = CONFIG[status];
  return (
    <Badge variant={variant} data-status={status}>
      <Icon aria-hidden className={status === "processing" ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}
