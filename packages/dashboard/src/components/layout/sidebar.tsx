"use client";

import {
  Bot,
  Home,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ConnectionStatusIndicator } from "@/components/ui/connection-status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnectionStatus } from "@/contexts/connection-provider";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Overview", href: "/", icon: Home },
  { label: "Conversations", href: "/conversations", icon: MessageSquare },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Tools", href: "/tools", icon: Wrench },
];

const COLLAPSED_KEY = "aesir-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const connectionStatus = useConnectionStatus();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) setCollapsed(stored === "true");
    setMounted(true);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  const isCollapsed = mounted ? collapsed : false;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col border-r bg-sidebar transition-all duration-200",
          isCollapsed ? "w-14" : "w-52",
        )}
      >
        {/* Header — logo only */}
        <div
          className={cn(
            "flex h-12 items-center border-b",
            isCollapsed ? "justify-center px-2" : "px-3",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex items-center gap-2.5",
              isCollapsed && "justify-center",
            )}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bot className="h-3.5 w-3.5" />
            </div>
            {!isCollapsed && (
              <span className="text-sm font-semibold tracking-tight">
                Aesir
              </span>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname.startsWith(item.href);

            const linkContent = (
              <Link
                href={item.href}
                className={cn(
                  "flex items-center rounded-md text-[13px] font-medium transition-colors",
                  isCollapsed
                    ? "h-9 w-9 justify-center"
                    : "gap-2.5 px-2.5 py-1.5",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && item.label}
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return <div key={item.href}>{linkContent}</div>;
          })}
        </nav>

        {/* Footer — connection status, theme, collapse */}
        <div
          className={cn(
            "border-t",
            isCollapsed ? "space-y-1 px-2 py-2" : "space-y-2 px-3 py-2.5",
          )}
        >
          {isCollapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center py-1">
                    <ConnectionDot status={connectionStatus} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {connectionStatus === "connected"
                    ? "Live"
                    : connectionStatus === "disconnected"
                      ? "Offline"
                      : "Reconnecting"}
                </TooltipContent>
              </Tooltip>
              <div className="flex justify-center">
                <ThemeToggle collapsed />
              </div>
              <div className="flex justify-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={toggleCollapsed}
                    >
                      <PanelLeftOpen className="h-3.5 w-3.5" />
                      <span className="sr-only">Expand sidebar</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Expand sidebar</TooltipContent>
                </Tooltip>
              </div>
            </>
          ) : (
            <>
              <ConnectionStatusIndicator status={connectionStatus} />
              <div className="flex items-center justify-between">
                <ThemeToggle />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={toggleCollapsed}
                    >
                      <PanelLeftClose className="h-3.5 w-3.5" />
                      <span className="sr-only">Collapse sidebar</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Collapse sidebar</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

// ─── Collapsed Connection Dot ────────────────────────────────────────────────

function ConnectionDot({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-signal" />
    );
  }
  if (status === "disconnected") {
    return <span className="h-1.5 w-1.5 rounded-full bg-red-500" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />;
}
