import type { IntegrationHealth as IntegrationHealthType } from "@/services/tools";

interface IntegrationHealthProps {
  integrations: IntegrationHealthType[];
}

export function IntegrationHealth({ integrations }: IntegrationHealthProps) {
  return (
    <div>
      <p>Integration health placeholder ({integrations.length} integrations)</p>
    </div>
  );
}
