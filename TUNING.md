# RAG Configuration & Tuning Guide

## Environment Variables

### Required (Ollama)
```env
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
LLM_MODEL=gemma2
```

### Server
```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
```

## Tuning Parameters

All tuning happens in `src/services/rag.service.ts`:

### 1. Chunk Size

**Location**: Line ~43 in `rag.service.ts`

```typescript
private readonly CHUNK_SIZE = 500; // ← Change this
```

**What it does**: Controls how much text per chunk

| Value | Use Case | Pros | Cons |
|-------|----------|------|------|
| 200 | Short, focused context | Precise results | May miss context |
| 500 | **DEFAULT** Balanced | Good balance | Medium memory |
| 1000 | Long, rich context | Better continuity | Higher memory use |
| 2000 | Very long documents | Preserves flow | Heavy computation |

**Recommendation**: Start with 500. Increase if answers lack context.

### 2. Chunk Overlap

**Location**: Line ~44

```typescript
private readonly CHUNK_OVERLAP = 100; // ← Change this
```

**What it does**: How much text overlaps between chunks

```
Chunk 1: "The Amazon Rainforest is the world's largest tropical rainforest."
                                    └─── 100 chars overlap ───┐
Chunk 2:                                               "rainforest by area..."
```

| Value | Effect | Use When |
|-------|--------|----------|
| 0 | No overlap | Cutting-edge topic words |
| 50 | Light overlap | Fast processing needed |
| 100 | **DEFAULT** Medium overlap | General use |
| 200 | Heavy overlap | Complex, nuanced content |

**Recommendation**: Keep at 100. Increase if chunking breaks mid-sentence.

### 3. Top K (Number of Relevant Chunks)

**Location**: Line ~45

```typescript
private readonly TOP_K = 5; // ← Change this
```

**What it does**: How many chunks to use as context for the LLM

| Value | Context Size | Best For | Impact |
|-------|--------------|----------|--------|
| 1 | ~500 chars | Quick answers | May miss info |
| 3 | ~1500 chars | Faster responses | Balanced |
| 5 | ~2500 chars | **DEFAULT** Rich answers | Standard |
| 10 | ~5000 chars | Comprehensive | May confuse LLM |
| 20+ | ~10000+ chars | Complex questions | Slow, expensive |

**Recommendation**: Start with 5. Increase for complex questions, decrease for speed.

---

## Model Selection

### Embedding Models (for vector search)

All good for RAG:

```
nomic-embed-text (RECOMMENDED)
├─ Size: 274M
├─ Dims: 384
├─ Speed: ~10ms/chunk
├─ Quality: Excellent
└─ Memory: ~200MB

all-minilm:latest
├─ Size: 50M
├─ Dims: 384
├─ Speed: ~5ms/chunk
├─ Quality: Good
└─ Memory: ~50MB

all-mpnet:latest
├─ Size: 440M
├─ Dims: 768
├─ Speed: ~20ms/chunk
├─ Quality: Very Good
└─ Memory: ~500MB
```

**Change in `.env`**:
```env
EMBEDDING_MODEL=all-minilm  # or any embedding model
```

### LLM Models (for answer generation)

```
gemma2:latest (RECOMMENDED)
├─ Size: 5.5B params
├─ RAM: ~5GB
├─ Speed: 2-5 sec/answer
├─ Quality: Good
└─ Context: 8K tokens

mistral:latest
├─ Size: 7B params
├─ RAM: ~8GB
├─ Speed: 3-8 sec/answer
├─ Quality: Excellent
└─ Context: 32K tokens

llama2:latest
├─ Size: 7B params
├─ RAM: ~8GB
├─ Speed: 3-8 sec/answer
├─ Quality: Very Good
└─ Context: 4K tokens

neural-chat:latest
├─ Size: 7B params
├─ RAM: ~8GB
├─ Speed: 2-5 sec/answer
├─ Quality: Good for chat
└─ Context: 8K tokens

(Smaller/Faster)
phi:latest
├─ Size: 2.7B params
├─ RAM: ~2GB
├─ Speed: 1-2 sec/answer
├─ Quality: Basic
└─ Context: 4K tokens
```

**Change in `.env`**:
```env
LLM_MODEL=mistral  # or any LLM model
```

**Speed comparison** (on typical CPU):
```
phi        ~1s  ████
neural-chat ~3s  ████████
mistral    ~5s  ██████████
gemma2     ~4s  █████████
llama2     ~6s  ███████████
```

---

## Performance Tuning

### For Speed (Real-time Chat)

```typescript
// src/services/rag.service.ts
private readonly CHUNK_SIZE = 300;      // Smaller chunks
private readonly CHUNK_OVERLAP = 50;    // Less overlap
private readonly TOP_K = 3;             // Fewer chunks
```

```env
# .env
EMBEDDING_MODEL=all-minilm
LLM_MODEL=phi
```

**Expected speed**: ~2-3 seconds per question

### For Quality (Research/Analysis)

```typescript
// src/services/rag.service.ts
private readonly CHUNK_SIZE = 1000;     // Larger chunks
private readonly CHUNK_OVERLAP = 200;   // More overlap
private readonly TOP_K = 10;            // More context
```

```env
# .env
EMBEDDING_MODEL=all-mpnet
LLM_MODEL=mistral
```

**Expected speed**: ~8-12 seconds per question

### For Budget (Minimal Resources)

```typescript
// src/services/rag.service.ts
private readonly CHUNK_SIZE = 250;
private readonly CHUNK_OVERLAP = 25;
private readonly TOP_K = 2;
```

```env
# .env
EMBEDDING_MODEL=all-minilm
LLM_MODEL=phi
```

**Memory needed**: ~2.5GB

---

## System Requirements by Configuration

### Minimal Setup
```
CPU: Any (will be slow)
RAM: 3GB
Storage: 2GB (phi + all-minilm)
Time/Answer: 5-10 seconds
Quality: Basic
```

### Recommended Setup (Your Setup)
```
CPU: i5/Ryzen 5+ (or newer)
RAM: 8GB+
Storage: 10GB (gemma2 + nomic-embed)
Time/Answer: 3-5 seconds
Quality: Good
```

### High Performance Setup
```
CPU: i7/Ryzen 7+
GPU: NVIDIA GPU (optional, 4GB+)
RAM: 16GB+
Storage: 20GB
Time/Answer: 1-2 seconds (with GPU)
Quality: Excellent
```

---

## Optimization Techniques

### 1. Pre-warming Models

Load models into memory once to avoid cold starts. Listing models does not load them; a request does:

```typescript
// In index.ts, before listening
import { createChatModel, createEmbeddings } from './lib/ai/models';

const start = async () => {
  // One tiny request each loads the model into Ollama's memory.
  await Promise.all([createChatModel().invoke('hi'), createEmbeddings().embedQuery('hi')]);
  // ...rest of startup
};
```

### 2. Reranking (Advanced)

Use a smaller model to rerank results:

```typescript
// In queryDocuments method, after getting top 20 chunks:
const rerankedChunks = await rerankChunks(question, topChunks);
// Use top 5 from reranked results
```

Would improve quality but add latency.

### 3. Caching

```typescript
private embeddingCache = new Map<string, number[]>();

async generateEmbedding(text: string): Promise<number[]> {
  if (this.embeddingCache.has(text)) {
    return this.embeddingCache.get(text)!;
  }
  
  const embedding = await ollama.embed(...);
  this.embeddingCache.set(text, embedding);
  return embedding;
}
```

Reduces re-embedding of same chunks.

### 4. Batch Processing

```typescript
// Embed multiple chunks in parallel
const embeddings = await Promise.all(
  chunks.map(c => generateEmbedding(c))
);
```

Already implemented in upload!

---

## Monitoring

### Add Metrics to Track

```typescript
// In rag.service.ts
private metrics = {
  documentsUploaded: 0,
  chunksCreated: 0,
  queriesProcessed: 0,
  totalEmbeddingTime: 0,
  totalLLMTime: 0,
};
```

### Performance Logging

```typescript
async queryDocuments(question: string, fileIds: string[]) {
  const startTime = Date.now();
  
  // ... existing code ...
  
  const embeddingStart = Date.now();
  const questionEmbedding = await generateEmbedding(question);
  const embeddingTime = Date.now() - embeddingStart;
  
  // ... similarity search ...
  
  const llmStart = Date.now();
  const answer = await generateAnswer(question, context);
  const llmTime = Date.now() - llmStart;
  
  console.log({
    question: question.substring(0, 50),
    embeddingTime: `${embeddingTime}ms`,
    llmTime: `${llmTime}ms`,
    totalTime: `${Date.now() - startTime}ms`,
  });
  
  return result;
}
```

---

## Troubleshooting Performance

| Problem | Cause | Solution |
|---------|-------|----------|
| Very slow first query | Models not loaded | Warmup with health check |
| Consistently slow | CPU-only | Enable GPU if available |
| Variable speed | Llama server busy | Restart ollama serve |
| High memory usage | Large TOP_K | Reduce TOP_K value |
| OOM errors | Model too large | Use smaller model |
| Poor answer quality | TOP_K too low | Increase TOP_K |
| Irrelevant results | Poor chunks | Increase CHUNK_SIZE |

---

## Production Recommendations

For a production system, also consider:

1. **Persistent Vector Database**
   - PostgreSQL + pgvector
   - Pinecone (cloud)
   - Milvus (self-hosted)

2. **Caching Layer**
   - Redis for embedding cache
   - Response cache for common questions

3. **Load Balancing**
   - Multiple Ollama instances
   - Load balancer for API

4. **Monitoring**
   - Response time tracking
   - Error rates
   - Cache hit rates

5. **Security**
   - API key authentication
   - Rate limiting
   - Input validation

See `OLLAMA_RAG_SETUP.md` for more details.
