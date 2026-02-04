import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ToolPerformance() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Performance charts loading in next plan...
        </p>
      </CardContent>
    </Card>
  );
}
