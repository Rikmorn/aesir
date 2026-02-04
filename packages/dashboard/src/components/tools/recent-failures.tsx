import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RecentFailures() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Failures</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Failure list loading in next plan...
        </p>
      </CardContent>
    </Card>
  );
}
