#!/bin/bash
# Quick start script for Ollama RAG setup

echo "================================"
echo "Ollama RAG Quick Start"
echo "================================"

# Check if Ollama is running
echo ""
echo "1. Checking Ollama service..."
if response=$(curl -s http://localhost:11434/api/tags 2>/dev/null); then
    echo "   ✓ Ollama is running"
    echo "   Available models:"
    # Parse models without jq - just extract name field
    echo "$response" | grep -oP '"name":"?\K[^,"]*' | while read model; do
        echo "   - $model"
    done
else
    echo "   ✗ Ollama is not running!"
    echo "   Start it with: ollama serve"
    exit 1
fi

# Check required models
echo ""
echo "2. Checking required models..."
has_embedding=$(echo "$response" | grep -o "nomic-embed-text" | head -1)
has_llm=$(echo "$response" | grep -E "gemma2|gemma3" | head -1)

if [ -n "$has_embedding" ]; then
    echo "   ✓ nomic-embed-text found"
else
    echo "   ✗ nomic-embed-text not found"
    echo "   Pull it: ollama pull nomic-embed-text"
fi

if [ -n "$has_llm" ]; then
    echo "   ✓ LLM model (gemma2/gemma3) found"
else
    echo "   ✗ LLM model not found"
    echo "   Pull it: ollama pull gemma2"
fi

if [ -z "$has_embedding" ] || [ -z "$has_llm" ]; then
    exit 1
fi

# Check if in correct directory
echo ""
echo "3. Checking location..."
if [ ! -f "package.json" ]; then
    echo "   ✗ Not in API directory!"
    echo "   Run from: apps/api/"
    exit 1
fi
echo "   ✓ In correct directory"

# Setup environment
echo ""
echo "4. Setting up environment..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "   ✓ Created .env from .env.example"
    else
        echo "   ⚠ .env.example not found"
    fi
else
    echo "   ✓ .env already exists"
fi

# Install dependencies
echo ""
echo "5. Installing dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✓ Dependencies already installed"
else
    npm install
    if [ $? -eq 0 ]; then
        echo "   ✓ Dependencies installed"
    else
        echo "   ✗ Failed to install dependencies"
        exit 1
    fi
fi

# Success
echo ""
echo "================================"
echo "✓ Setup complete!"
echo "================================"
echo ""
echo "Start the API with: npm run dev"
echo "The API will be available at: http://localhost:3001"
echo ""
echo "Test with:"
echo "  POST http://localhost:3001/api/rag/upload (upload document)"
echo "  POST http://localhost:3001/api/rag/query (ask questions)"
