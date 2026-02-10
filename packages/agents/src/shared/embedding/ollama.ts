import type { EmbeddingService, EmbeddingServiceOptions } from "./types.js";

/**
 * Creates an Ollama embedding provider using the REST API.
 *
 * Ollama does NOT support batch embeddings natively, so embedBatch
 * processes texts sequentially using individual embed calls.
 * Failures return null per item without aborting the batch.
 */
export function createOllamaEmbedding(
  options: EmbeddingServiceOptions,
): EmbeddingService {
  const { config, logger } = options;
  const baseUrl = config.ollama.url;
  const model = config.ollama.model;

  return {
    async embed(text: string): Promise<number[] | null> {
      try {
        const response = await fetch(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: text }),
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          logger.warn(
            { status: response.status, model },
            "Ollama embed request failed",
          );
          return null;
        }

        const data = (await response.json()) as {
          embeddings?: number[][];
        };
        return data.embeddings?.[0] ?? null;
      } catch (err) {
        logger.warn({ err, model }, "Ollama embed failed");
        return null;
      }
    },

    async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
      return Promise.all(texts.map((t) => this.embed(t)));
    },
  };
}
