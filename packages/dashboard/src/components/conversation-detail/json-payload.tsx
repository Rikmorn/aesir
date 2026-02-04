const DEFAULT_MAX_HEIGHT = "300px";
const DEFAULT_MAX_LENGTH = 10000;

interface JsonPayloadProps {
  data: unknown;
  maxHeight?: string;
  maxLength?: number;
}

export function JsonPayload({
  data,
  maxHeight = DEFAULT_MAX_HEIGHT,
  maxLength = DEFAULT_MAX_LENGTH,
}: JsonPayloadProps) {
  if (data === null || data === undefined) {
    return (
      <pre className="overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
        <code>null</code>
      </pre>
    );
  }

  let jsonString = JSON.stringify(data, null, 2);

  const isTruncated = jsonString.length > maxLength;
  if (isTruncated) {
    jsonString = `${jsonString.slice(0, maxLength)}\n... (truncated)`;
  }

  return (
    <pre
      className="overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
      style={{ maxHeight }}
    >
      <code>{jsonString}</code>
    </pre>
  );
}
