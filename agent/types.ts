/**
 * Type definitions for the Agentic AI Assistant
 */

export interface WriteFileInput {
  path: string
  content: string
}

export interface Config {
  ollamaModel: string
  ollamaTemperature: number
  ollamaBaseUrl: string
}

export interface AgentMessage {
  role: "user" | "assistant" | "system"
  content: string
}