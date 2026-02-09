import dotenv from "dotenv"
import { Config } from "./types"

// Load environment variables from .env file
dotenv.config()

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    ollamaModel: process.env.OLLAMA_MODEL || "gemma3",
    ollamaTemperature: parseFloat(process.env.OLLAMA_TEMPERATURE || "0.2"),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434"
  }
}

const config = loadConfig()

/**
 * Initialize the Ollama LLM with configuration
 */
import { ChatOllama } from "@langchain/ollama"

export const llm = new ChatOllama({
  model: config.ollamaModel,
  temperature: config.ollamaTemperature,
  baseUrl: config.ollamaBaseUrl
})

export { config }
