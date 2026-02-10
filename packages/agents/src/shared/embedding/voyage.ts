import { VoyageAIClient, VoyageAIError } from "voyageai";

import type { EmbeddingService, EmbeddingServiceOptions } from "./types.js";

/**
 * Creates a Voyage AI embedding provider using the official SDK.
 *
 * Fails fast at creation time if the API key is missing. The SDK handles
 * retries and rate limiting internally. Both embed and embedBatch return
 * null on failure for graceful degradation.
 */
export function createVoyageEmbedding(
  options: EmbeddingServiceOptions,
): EmbeddingService {
  const { config, logger } = options;

  if (!config.voyage.apiKey) {
    throw new Error(
      "VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage",
    );
  }

  const client = new VoyageAIClient({ apiKey: config.voyage.apiKey });
  const model = config.voyage.model;

  return {
    async embed(text: string): Promise<number[] | null> {
      try {
        const response = await client.embed(
          { input: text, model, inputType: "document" },
          { timeoutInSeconds: 10 },
        );
        return response.data?.[0]?.embedding ?? null;
      } catch (err) {
        if (err instanceof VoyageAIError) {
          logger.warn(
            { statusCode: err.statusCode, model },
            "Voyage AI embed failed",
          );
        } else {
          logger.warn({ err, model }, "Voyage AI embed failed");
        }
        return null;
      }
    },

    async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
      try {
        const response = await client.embed(
          { input: texts, model, inputType: "document" },
          { timeoutInSeconds: 10 },
        );
        return texts.map((_, i) => response.data?.[i]?.embedding ?? null);
      } catch (err) {
        if (err instanceof VoyageAIError) {
          logger.warn(
            { statusCode: err.statusCode, model },
            "Voyage AI embedBatch failed",
          );
        } else {
          logger.warn({ err, model }, "Voyage AI embedBatch failed");
        }
        return texts.map(() => null);
      }
    },
  };
}
