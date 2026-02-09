# AI Agent - Agentic Assistant

A fully autonomous AI agent powered by LangChain and Ollama with intelligent tool use, decision-making, and multi-turn conversations.

## 🎯 Features

**🤖 Autonomous Tool Use**  
- Agent decides when and how to use tools
- No predetermined pipeline - truly agentic behavior

**🧠 Think-Act-Observe Loop**  
- Agent reasons about tasks step-by-step
- Uses tools to gather information or take action
- Observes results and adapts strategy

**🛠️ Comprehensive Tools**  
- File reading and writing
- Project structure analysis
- Code file searching and examination
- Codebase comprehensive analysis

**💬 Multi-turn Conversations**  
- Interactive CLI chat with agent
- Maintains context between messages
- Single-question mode also supported

**🔧 Configurable**  
- Environment variables for LLM selection, temperature
- Fully local (no API keys needed)

**🚀 Local-first**  
- Uses Ollama for 100% local execution
- Works offline after model download
- No external API dependencies

## 📋 Prerequisites

- **Node.js** 20+ (check with `node --version`)
- **Ollama** running locally (download from [ollama.ai](https://ollama.ai))
- **A local LLM model** (e.g., `ollama pull gemma:latest`)

## 🚀 Installation

```bash
# Navigate to agent directory
cd agent

# Install dependencies
npm install

# Copy environment template (optional, defaults are already set)
cp .env.example .env
```

## ⚙️ Configuration

Edit `.env` to customize:

```env
# Ollama Configuration
OLLAMA_MODEL=gemma3                 # Model to use
OLLAMA_TEMPERATURE=0.2              # Creativity (0.0-1.0)
OLLAMA_BASE_URL=http://localhost:11434  # Ollama server URL

# Debug
DEBUG=false                         # Set to 'true' for detailed output
```

Available models: `gemma3`, `neural-chat`, `mistral`, `llama2`, etc.

## 💻 Quick Start

### Interactive Agent (Recommended!)

```bash
npm run dev

# or
npm run dev --agent
```

### Single Question

```bash
npm run dev --ask "Analyze this codebase"
```

### Debug Mode

```bash
npm run dev:debug --agent
```

## 📁 Project Structure

```
agent/
├── executor/
│   └── agentExecutor.ts      # Main agent loop and execution
├── tools/
│   ├── agentTools.ts          # Tool definitions
│   └── codebaseReader.ts      # Codebase analysis utility
├── config.ts                  # LLM configuration
├── index.ts                   # CLI entry point
├── types.ts                   # TypeScript interfaces
├── .env                       # Environment variables
└── package.json               # Dependencies
```

## 🛠️ Available Tools

The agent autonomously uses these tools:

| Tool | Purpose |
|------|---------|
| `read_file` | Read and examine specific files |
| `list_files` | List files in a directory |
| `search_files` | Search for files matching patterns |
| `get_project_structure` | Get directory tree structure |
| `analyze_codebase` | Comprehensive codebase analysis |
| `write_file` | Write content to files |
| `ask_user` | Ask clarification questions |

## 🎯 How It Works

### Agentic Loop

1. **THINK**: Agent analyzes your request and formulates strategy
2. **ACT**: Agent uses tools to gather information or take actions
3. **OBSERVE**: Agent examines results and decides next steps
4. **REPEAT**: Process continues until task is complete

### Example Flow

```
User: "Generate a README for this project"
        ↓
Agent THINKS: "I need to understand the project"
        ↓
Agent ACTS: Uses get_project_structure and read_file tools
        ↓
Agent OBSERVES: Has project structure and key files
        ↓
Agent THINKS: "Now I can write a comprehensive README"
        ↓
Agent ACTS: Uses write_file tool
        ↓
Agent RESPONDS: "I've created README.md"
```

## 💻 Development Scripts

```bash
# Development (interactive mode by default)
npm run dev

# Debug mode
npm run dev:debug

# Build TypeScript to JavaScript
npm run build

# Clean build output
npm run clean

# Run pre-built version
npm start
```

## 📚 Documentation

See [AGENTIC.md](./AGENTIC.md) for detailed information about advanced features and workflows.

## 🔧 Troubleshooting

### Agent not responding
```bash
# Check Ollama is running
ollama serve

# Check model is available
ollama list

# Run with debug mode
npm run dev:debug
```

### Tool execution fails
- Check file paths are correct
- Ensure permissions for file operations
- Review error messages in debug mode

### Agent takes too long
- Use a faster model: `OLLAMA_MODEL=neural-chat npm run dev`
- Reduce temperature: `OLLAMA_TEMPERATURE=0.1`
- Ask more specific questions

## 🌟 Example Interactions

### Codebase Analysis
```
You: What is the main architecture of this project?
🤖 Agent: I'll analyze the project structure...
   This appears to be a monorepo with...
```

### Code Generation
```
You: Create comprehensive API documentation
🤖 Agent: I'll examine the codebase and generate documentation...
   Created API_DOCS.md with full API reference
```

### Project Understanding
```
You: Explain what this project does
🤖 Agent: Let me read the project structure...
   This project is a full-stack AI application with...
```

## 🚀 Advanced Features

### Custom Model Selection
```bash
OLLAMA_MODEL=mistral npm run dev
OLLAMA_MODEL=neural-chat npm run dev
```

### Batch Processing
```bash
for dir in ~/projects/*/; do
  npm run dev --ask "Analyze $dir" > "${dir%/}_analysis.txt"
done
```

### Environment Variables
```bash
# Adjust creativity
OLLAMA_TEMPERATURE=0.5 npm run dev

# Use different server
OLLAMA_BASE_URL=http://remote-server:11434 npm run dev

# Enable debug logging
DEBUG=true npm run dev
```

## 📝 Notes

- All execution happens locally (no external APIs)
- Agent reasoning and tool calls are displayed in real-time
- Each conversation is independent (no persistence between sessions)
- Responses are immediate (no streaming - waits for full response)

## 🚀 Future Enhancements

- Web search tool for external information
- Git integration for version control
- Database query tools
- API calling capabilities
- Custom tool plugins
- Multi-agent collaboration
- Session persistence
- Streaming responses

## 📜 License

ISC
