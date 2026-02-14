import {
  CheckCircle,
  Circle,
  type LucideIcon,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  XCircle,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

const iconMap: Record<string, LucideIcon> = {
  "agent.started": PlayCircle,
  "agent.completed": CheckCircle,
  "agent.paused": PauseCircle,
  "agent.resumed": PlayCircle,
  "agent.reopened": RotateCcw,
  "tool.called": Zap,
  "tool.succeeded": CheckCircle,
  "tool.failed": XCircle,
  "llm.response": MessageCircle,
  "signal.received": Zap,
};

const colorMap: Record<string, string> = {
  "agent.started": "text-indigo-500",
  "agent.completed": "text-emerald-500",
  "agent.paused": "text-amber-500",
  "agent.resumed": "text-indigo-500",
  "agent.reopened": "text-indigo-400",
  "tool.called": "text-violet-500",
  "tool.succeeded": "text-emerald-500",
  "tool.failed": "text-red-500",
  "llm.response": "text-indigo-400",
  "signal.received": "text-amber-500",
};

export function EventIcon({ type }: { type: string }) {
  const Icon = iconMap[type] ?? Circle;
  const color = colorMap[type] ?? "text-muted-foreground";

  return <Icon className={cn("h-4 w-4", color)} />;
}
