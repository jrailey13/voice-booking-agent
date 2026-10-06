# Ollama RAG Setup Guide

This guide walks you through setting up Ollama-based RAG (Retrieval-Augmented Generation) for local AI-powered document querying.

## Prerequisites

- [Ollama](https://ollama.ai) installed and running
- Node.js 18+
- Already pulled models:
  - `gemma2` (or `gemma3`) - LLM for generating answers
  - `nomic-embed-text` - Embedding model for vector search

## 1. Start Ollama

Before running the API, start Ollama in a terminal:

```powershell
ollama serve
```

This will start the Ollama server on `http://localhost:11434` (default).

## 2. Verify Models are Pulled

Check that your models are available:

```powershell
ollama list
```

You should see:
- `nomic-embed-text` (for embeddings)
- `gemma2` or `gemma3` (for LLM)

If not, pull them:

```powershell
ollama pull nomic-embed-text
ollama pull gemma2  # or gemma3
```

## 3. Configure Environment

Copy `.env.example` to `.env` and update if needed:

```bash
# apps/api/.env
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
LLM_MODEL=gemma2
```

## 4. Install Dependencies

```powershell
cd apps/api
npm install
```

## 5. Run the API

```powershell
npm run dev
```

The API will start on `http://localhost:3000`.

## 6. Test the RAG Endpoints

### Upload a Document

```bash
# Create a test file
echo "The capital of France is Paris. Paris is known for the Eiffel Tower." > test.txt

# Upload
curl -X POST \
  -F "file=@test.txt" \
  http://localhost:3000/api/rag/upload
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "test.txt",
  "size": 80,
  "type": "text/plain",
  "status": "ready"
}
```

### Query Documents

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the capital of France?",
    "fileIds": ["550e8400-e29b-41d4-a716-446655440000"]
  }' \
  http://localhost:3000/api/rag/query
```

Response:
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "answer": "The capital of France is Paris. It is known for the Eiffel Tower.",
  "timestamp": "2026-01-28T10:30:00.000Z",
  "sources": [
    {
      "title": "test.txt",
      "snippet": "The capital of France is Paris. Paris is known for the Eiffel Tower..."
    }
  ]
}
```

### Delete a Document

```bash
curl -X DELETE http://localhost:3000/api/rag/documents/550e8400-e29b-41d4-a716-446655440000
```

## How It Works

The pipeline is built from LangChain parts. See [`OLLAMA_RAG_README.md`](../../OLLAMA_RAG_README.md) for the full walkthrough.

1. **Upload**
   - Text is extracted from TXT, PDF (`pdf-parse`) or DOCX (`mammoth`)
   - `RecursiveCharacterTextSplitter` splits it into chunks of at most 500 characters with 100 characters of overlap, preferring paragraph, line and word boundaries
   - Each chunk is embedded with `nomic-embed-text` (`OllamaEmbeddings`)
   - The document and its chunks are written to Postgres (`rag_documents`, `rag_chunks`) in one transaction

2. **Query**
   - The question is embedded, and the 5 most similar chunks from the selected files are found by cosine similarity
   - Those chunks become the context for the LLM (`LLM_MODEL`, default `gemma3`)
   - The answer is returned with its source documents and snippets

## Performance Tips

- `CHUNK_SIZE`, `CHUNK_OVERLAP` and `TOP_K` are constants in `src/services/rag.service.ts`
- Similarity is computed in process over the selected files' chunks. For a large corpus, move to pgvector (see `docs/langchain-architecture.md` §9)

## Production Improvements

### 1. Implement Streaming for Long Documents

Use Ollama's stream API for real-time chunk processing.

### 2. Add Query Caching

Cache question embeddings and answers to improve response time.

## Troubleshooting

### "Failed to connect to Ollama"
- Ensure `ollama serve` is running
- Check `OLLAMA_BASE_URL` in `.env`
- Default is `http://localhost:11434`

### "Model not found"
- Run `ollama list` to see available models
- Pull missing model: `ollama pull <model-name>`

### "No relevant information found"
- Upload documents first
- Check that documents contain relevant content
- Adjust `TOP_K` to use more chunks
- Check chunk similarity scores in debug logs

### Slow response times
- Ollama models run on CPU by default (slow)
- GPU support: `ollama serve --gpu=true` (requires NVIDIA CUDA)
- Consider smaller models like `mistral` or `neural-chat`

## Models Reference

### Embedding Models (Compact, Fast)
- `nomic-embed-text` - Excellent for RAG (384-dim)
- `all-minilm` - Lightweight alternative

### LLM Models (Generate Answers)
- `gemma2` - Balanced, good for RAG
- `mistral` - Smaller, faster
- `neural-chat` - Optimized for conversation
- `llama2` - More capable but heavier

### Memory Requirements
- Embedding model: ~200MB
- LLM model: Varies (1GB-10GB+)

## Next Steps

1. ✅ Implement to-be-used models
2. ⏳ Add persistent storage (PostgreSQL + pgvector)
3. ⏳ Add PDF/DOCX support
4. ⏳ Implement streaming for large docs
5. ⏳ Add semantic caching
