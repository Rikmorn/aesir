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
  "agent.started": "text-blue-500",
  "agent.completed": "text-green-500",
  "agent.paused": "text-yellow-500",
  "agent.resumed": "text-blue-500",
  "agent.reopened": "text-cyan-500",
  "tool.called": "text-purple-500",
  "tool.succeeded": "text-green-500",
  "tool.failed": "text-red-500",
  "llm.response": "text-blue-400",
  "signal.received": "text-orange-500",
};

export function EventIcon({ type }: { type: string }) {
  const Icon = iconMap[type] ?? Circle;
  const color = colorMap[type] ?? "text-muted-foreground";

  return <Icon className={cn("h-4 w-4", color)} />;
}
