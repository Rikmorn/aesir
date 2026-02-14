import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationMs, formatRelativeTime } from "@/lib/format";
import type { IntegrationHealth as IntegrationHealthType } from "@/services/tools";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntegrationHealthProps {
  integrations: IntegrationHealthType[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IntegrationHealth({ integrations }: IntegrationHealthProps) {
  if (integrations.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No integration health data available
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {integrations.map((integration) => {
        const isHealthy = integration.status === "healthy";
        const lastChecked = integration.lastChecked
          ? formatRelativeTime(new Date(integration.lastChecked))
          : "-";

        return (
          <Card key={integration.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {/* Status dot */}
                <span
                  role="img"
                  className={`h-1.5 w-1.5 rounded-full ${isHealthy ? "bg-emerald-500 animate-pulse-signal" : "bg-red-500"}`}
                  aria-label={isHealthy ? "Healthy" : "Unhealthy"}
                />
                {capitalize(integration.name)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd
                    className={
                      isHealthy
                        ? "font-medium text-emerald-700 dark:text-emerald-400"
                        : "font-medium text-red-700 dark:text-red-400"
                    }
                  >
                    {isHealthy ? "Healthy" : "Unhealthy"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Latency</dt>
                  <dd className="font-mono">
                    {formatDurationMs(integration.latencyMs)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd>{lastChecked}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(str: string): string {
  if (str.length === 0) return str;
  // Handle "github" -> "GitHub" special case
  if (str.toLowerCase() === "github") return "GitHub";
  return str.charAt(0).toUpperCase() + str.slice(1);
}
