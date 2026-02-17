import {
  AlertCircle,
  AlertTriangle,
  BellOff,
  CheckCircle,
  Circle,
  Clock,
  HelpCircle,
  type LucideIcon,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
  XOctagon,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

const iconMap: Record<string, LucideIcon> = {
  "agent.started": PlayCircle,
  "agent.completed": CheckCircle,
  "agent.paused": PauseCircle,
  "agent.resumed": PlayCircle,
  "agent.reopened": RotateCcw,
  "agent.stale_recovered": AlertTriangle,
  "agent.retry_scheduled": RefreshCw,
  "tool.called": Zap,
  "tool.succeeded": CheckCircle,
  "tool.failed": XCircle,
  "llm.response": MessageCircle,
  "signal.received": Zap,
  "signal.orphaned": HelpCircle,
  "mcp.error": AlertCircle,
  "mcp.rate_limited": Clock,
  "mcp.retries_exhausted": XOctagon,
  "notification.failed": BellOff,
};

const colorMap: Record<string, string> = {
  "agent.started": "text-indigo-500",
  "agent.completed": "text-emerald-500",
  "agent.paused": "text-amber-500",
  "agent.resumed": "text-indigo-500",
  "agent.reopened": "text-indigo-400",
  "agent.stale_recovered": "text-amber-500",
  "agent.retry_scheduled": "text-amber-500",
  "tool.called": "text-violet-500",
  "tool.succeeded": "text-emerald-500",
  "tool.failed": "text-red-500",
  "llm.response": "text-indigo-400",
  "signal.received": "text-amber-500",
  "signal.orphaned": "text-muted-foreground",
  "mcp.error": "text-red-400",
  "mcp.rate_limited": "text-amber-400",
  "mcp.retries_exhausted": "text-red-500",
  "notification.failed": "text-red-500",
};

export function EventIcon({ type }: { type: string }) {
  const Icon = iconMap[type] ?? Circle;
  const color = colorMap[type] ?? "text-muted-foreground";

  return <Icon className={cn("h-4 w-4", color)} />;
}
