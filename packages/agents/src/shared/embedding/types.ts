import type { PinoLogger } from "@aesir/platform";

export interface EmbeddingService {
  /** Embed a single text. Returns null on any failure (graceful degradation). */
  embed(text: string): Promise<number[] | null>;
  /** Embed multiple texts. Returns null for each failed embedding. */
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;
}

export interface EmbeddingConfig {
  provider: "ollama" | "voyage";
  dimensions: number;
  ollama: {
    url: string;
    model: string;
  };
  voyage: {
    apiKey: string | undefined;
    model: string;
  };
}

export interface EmbeddingServiceOptions {
  config: EmbeddingConfig;
  logger: PinoLogger;
}
