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

1. **Upload**: 
   - Text is extracted from the document
   - Split into 500-character chunks with 100-character overlap
   - Each chunk is embedded using `nomic-embed-text`
   - Embeddings and chunks are stored in memory

2. **Query**:
   - Question is converted to an embedding
   - Cosine similarity finds top 5 relevant chunks
   - Relevant chunks become context for the LLM
   - `gemma2` generates an answer based on context
   - Sources are returned

3. **Memory Storage**:
   - Currently uses in-memory Map (resets on restart)
   - For production, integrate with:
     - **Persistent Vector DB**: Pinecone, Weaviate, Milvus, or ChromaDB
     - **Document Storage**: PostgreSQL, MongoDB

## Performance Tips

- Adjust `CHUNK_SIZE` (default: 500) for better context coverage
- Adjust `TOP_K` (default: 5) to control how many chunks are used
- For large documents, consider streaming with Ollama

## Production Improvements

### 1. Add File Format Support

```bash
npm install pdf-parse mammoth
```

Update `rag.service.ts` to handle PDF/DOCX:

```typescript
private extractText(buffer: Buffer, mimetype: string): string {
  if (mimetype.includes('pdf')) {
    return pdf.parse(buffer); // Returns promise
  }
  if (mimetype.includes('wordprocessingml')) {
    return mammoth.extractRawText({ buffer });
  }
  return buffer.toString('utf-8');
}
```

### 2. Add Database Persistence

```bash
npm install @prisma/client prisma
```

Store chunks in a database instead of Map.

### 3. Implement Streaming for Long Documents

Use Ollama's stream API for real-time chunk processing.

### 4. Add Query Caching

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
