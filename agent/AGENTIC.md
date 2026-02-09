# AI Agent - Fully Agentic System

This agent now includes full agentic capabilities with autonomous tool use, decision-making, and multi-turn conversations.

## 🎯 Features

### Agentic Modes

1. **Interactive Agentic Mode** (`--agent`)
   - Multi-turn conversation with the agent
   - Agent autonomously decides which tools to use
   - Persistent reasoning loop with thinking-acting-observing
   - Type `quit` to exit

2. **Single-Question Mode** (`--ask`)
   - Ask the agent a question and get a response
   - Agent uses tools as needed to answer

3. **Legacy Modes**
   - `--idea`: Generate requirements from a text idea
   - `--codebase`: Analyze a codebase and generate requirements
   - `--idea + --codebase`: Generate epics from requirements

## 🛠️ Available Tools

The agent has access to these tools for autonomous decision-making:

### Code Analysis Tools
- **read_file** - Read and examine specific files
- **list_files** - List files in a directory
- **search_files** - Search for files matching patterns
- **get_project_structure** - Get directory tree structure
- **analyze_codebase** - Comprehensive codebase analysis

### File Operations
- **write_file** - Write content to files with automatic directory creation

### Interaction
- **ask_user** - Ask clarification questions (for future CLI enhancement)

## 🚀 Usage Examples

### Interactive Agent (Recommended!)
```bash
npm run dev --agent
```

In interactive mode, you can:
```
You: Analyze this codebase and suggest improvements
🤖 Agent: [analyzes structure, reads key files, provides insights]

You: What are the main components?
🤖 Agent: [describes architecture]

You: Create a design document
🤖 Agent: [reads codebase, generates comprehensive design]

Type 'quit' to exit
```

### Single Question
```bash
npm run dev --ask "What technologies are used in this project?"
```

### With Specific Path
```bash
npm run dev --ask "Analyze /path/to/project"
```

## 🧠 How the Agent Works

The agent operates in a **think-act-observe loop**:

1. **THINK**: Analyzes your request and formulates a response strategy
2. **ACT**: Uses tools as needed (reads files, analyzes code, etc.)
3. **OBSERVE**: Examines the tool results and decides next steps
4. **REPEAT**: Continues until the task is complete

### Example Workflow

```
User: "Generate requirements for this project"
     ↓
Agent thinks: "I need to understand the codebase first"
     ↓
Agent uses: analyze_codebase tool
     ↓
Agent observes: [reads project structure, files, README]
     ↓
Agent thinks: "Now I can generate requirements based on what I learned"
     ↓
Agent uses: write_file tool
     ↓
Agent responds: "I've created requirements.md based on the codebase"
```

## 📋 Configuration

Configure the agent via `.env` file:

```env
# LLM Configuration
OLLAMA_MODEL=gemma3              # or any available Ollama model
OLLAMA_TEMPERATURE=0.2            # 0=deterministic, 1=creative
OLLAMA_BASE_URL=http://localhost:11434

# Output Configuration
DOCS_DIR=./docs
PROMPTS_DIR=./prompts
DEBUG=false
```

## 🔧 Advanced Features

### Tool Use Pattern
The agent detects tool use requests in the LLM response and automatically executes them. Tools can be invoked using patterns like:
- `[Tool: read_file] {...}`
- `Call the analyze_codebase tool with {...}`

### Multi-Tool Workflows
The agent can chain multiple tools together:
1. Analyze codebase
2. Read specific files
3. Write generated documents
4. Report findings

### Error Handling
The agent includes comprehensive error handling:
- Tool execution errors are gracefully handled
- Validation of tool inputs
- Clear error messages for debugging

## 📊 Example Agent Interactions

### Scenario 1: Architectural Analysis
```
You: Analyze the architecture of this project
🤖 Agent uses: get_project_structure, analyze_codebase, read_file (multiple)
🤖 Response: [Provides detailed architecture overview, component relationships, tech stack]
```

### Scenario 2: Code Generation
```
You: Create a test file for the main API routes
🤖 Agent uses: read_file, analyze_codebase, write_file
🤖 Response: [Creates test file with appropriate coverage]
```

### Scenario 3: Documentation
```
You: Generate API documentation
🤖 Agent uses: search_files, read_file, write_file
🤖 Response: [Creates comprehensive API documentation]
```

## 🎓 Learning Resources

### Related Files
- `/agent/executor/agentExecutor.ts` - Main agent loop and execution
- `/agent/tools/agentTools.ts` - Tool definitions
- `/agent/config.ts` - LLM configuration
- `/agent/index.ts` - CLI entry point

### Key Concepts
- **Agents**: Systems that make autonomous decisions
- **Tool Use**: Agents selecting and executing tools
- **Agentic Loop**: Think → Act → Observe cycle
- **Streaming**: Real-time output of agent reasoning

## 🐛 Troubleshooting

### Agent not responding
```bash
# Check Ollama is running
ollama serve

# Check model is available
ollama list

# Run with debug mode
DEBUG=true npm run dev:debug --agent
```

### Tool execution fails
- Check file paths are correct
- Ensure permissions for file operations
- Use `DEBUG=true` to see detailed error messages

### Agent takes too long
- Reduce max iterations: `npm run dev --ask "question"` (uses 10 by default)
- Use a faster model: `OLLAMA_MODEL=neural-chat npm run dev --agent`
- Reduce temperature for faster responses: `OLLAMA_TEMPERATURE=0.1`

## 🚀 Future Enhancements

Potential improvements:
- Web search tool for external information
- Git integration for version control
- Jira/issue tracker integration
- Custom tool plugins
- Agent memory persistence across sessions
- Streaming responses for long operations
- Parallel tool execution
- Multi-agent collaboration

## 📝 Notes

- The agent uses local Ollama models (no internet connection needed)
- All tool executions happen locally
- Agent reasoning and tool calls are visible in the console
- Each iteration shows what the agent is thinking and doing
