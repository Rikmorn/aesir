"use client";

import {
  Bot,
  Home,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Overview",
    href: "/",
    icon: Home,
  },
  {
    label: "Conversations",
    href: "/conversations",
    icon: MessageSquare,
  },
  {
    label: "Agents",
    href: "/agents",
    icon: Bot,
  },
  {
    label: "Tools",
    href: "/tools",
    icon: Wrench,
  },
];

const COLLAPSED_KEY = "aesir-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) {
      setCollapsed(stored === "true");
    }
    setMounted(true);
  }, []);

  // Persist collapsed state
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  // Avoid hydration mismatch by rendering expanded initially
  const isCollapsed = mounted ? collapsed : false;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col border-r bg-muted/30 transition-all duration-200",
          isCollapsed ? "w-14" : "w-56",
        )}
      >
        {/* Header with logo and collapse toggle */}
        <div
          className={cn(
            "flex h-14 items-center border-b",
            isCollapsed ? "justify-center px-2" : "justify-between px-3",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex items-center gap-2 font-semibold",
              isCollapsed && "justify-center",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bot className="h-4 w-4" />
            </div>
            {!isCollapsed && <span>Aesir</span>}
          </Link>

          {!isCollapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={toggleCollapsed}
                >
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="sr-only">Collapse sidebar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Expand button when collapsed - at the top for easy access */}
        {isCollapsed && (
          <div className="flex justify-center border-b py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={toggleCollapsed}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  <span className="sr-only">Expand sidebar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Navigation */}
        <nav
          className={cn("flex-1 space-y-1", isCollapsed ? "px-2 py-2" : "p-2")}
        >
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname.startsWith(item.href);

            const linkContent = (
              <Link
                href={item.href}
                className={cn(
                  "flex items-center rounded-md text-sm font-medium transition-colors",
                  isCollapsed ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

        {/* Footer - only show text when expanded */}
        {!isCollapsed && (
          <div className="border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Operations Dashboard
            </p>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}
