import { createOllamaEmbedding } from "./ollama.js";
import type { EmbeddingService, EmbeddingServiceOptions } from "./types.js";
import { createVoyageEmbedding } from "./voyage.js";

/**
 * Creates an EmbeddingService based on the configured provider.
 *
 * Selects between Ollama (development) and Voyage AI (production) based
 * on `config.provider`. Fails fast on unknown provider values.
 */
export function createEmbeddingService(
  options: EmbeddingServiceOptions,
): EmbeddingService {
  const { config, logger } = options;

  switch (config.provider) {
    case "ollama": {
      logger.info(
        {
          provider: "ollama",
          model: config.ollama.model,
          url: config.ollama.url,
        },
        "Creating Ollama embedding service",
      );
      return createOllamaEmbedding(options);
    }
    case "voyage": {
      logger.info(
        { provider: "voyage", model: config.voyage.model },
        "Creating Voyage AI embedding service",
      );
      return createVoyageEmbedding(options);
    }
    default: {
      throw new Error(
        `Unknown embedding provider: ${config.provider as string}`,
      );
    }
  }
}
