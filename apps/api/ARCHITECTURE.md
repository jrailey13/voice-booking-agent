# Ollama RAG System - Visual Guide

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Server (Express)                      │
│                    (apps/api/src/index.ts)                       │
└─────────────────┬─────────────────────────────────────────────┬──┘
                  │                                               │
         ┌────────▼──────────┐                    ┌───────────────▼─────┐
         │  RAG Routes       │                    │  Other Routes       │
         │ (src/routes/rag)  │                    │  (booking, voice)   │
         └────────┬──────────┘                    └─────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
POST            POST         DELETE
/upload         /query       /documents/:id
    │             │             │
    └─────────────┼─────────────┘
                  │
         ┌────────▼──────────────────┐
         │   RAG Service             │
         │ (src/services/rag.ts)     │
         │                           │
         │  uploadDocument()         │
         │  queryDocuments()         │
         │  deleteDocument()         │
         └────────┬──────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ Extract  │ │ Chunk    │ │ Embed with   │
│ Text     │ │ into     │ │ nomic-embed  │
│          │ │ 500 char │ │              │
└──────────┘ └──────────┘ └──────────────┘
                  │
         ┌────────▼──────────────────┐
         │ Store in Memory Map       │
         │ [DocumentID]              │
         │   ├─ chunks[]             │
         │   │   ├─ content          │
         │   │   ├─ embedding[]      │
         │   │   └─ chunkIndex       │
         │   ├─ name                 │
         │   └─ type                 │
         └────────────────────────────┘
```

## Query Flow (When User Asks a Question)

```
User Question
"What is the Amazon Rainforest?"
    │
    ▼
┌─────────────────────────────────┐
│ Generate Question Embedding      │
│ Using: nomic-embed-text         │
│ Output: [0.234, 0.567, ...]    │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Calculate Similarity Score       │
│ For: Every chunk embedding       │
│ Using: Cosine Similarity        │
│ Output: 0.87, 0.54, 0.91, ...   │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Sort by Relevance & Select Top 5│
│ Highest similarity chunks        │
│ Example:                         │
│  1. 0.91 - "The Amazon is..."   │
│  2. 0.87 - "It covers 5.5M..."  │
│  3. 0.82 - "Home to millions.."│
│  4. 0.76 - "Produces 20%..."   │
│  5. 0.74 - "Vital for climate"  │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Build Context                   │
│                                 │
│ Context:                        │
│ [source-1.txt]                  │
│ "The Amazon is the world's..."  │
│                                 │
│ [source-2.txt]                  │
│ "It covers 5.5 million sq km"   │
│ ...                             │
└─────────┬───────────────────────┘
          │
          ▼
┌──────────────────────────────────────────┐
│ Generate Answer with LLM (gemma2)        │
│                                          │
│ System Prompt:                           │
│ "You are a helpful assistant..."        │
│                                          │
│ User Input:                              │
│ Context: [The 5 relevant chunks]        │
│ Question: "What is the Amazon...?"      │
│                                          │
│ Model: gemma2 (generates answer)        │
└─────────┬────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────┐
│ Return Answer to User                    │
│                                          │
│ {                                        │
│   "answer": "The Amazon Rainforest...",│
│   "sources": [                           │
│     { "title": "source-1.txt", ...},    │
│     { "title": "source-2.txt", ...}     │
│   ],                                     │
│   "timestamp": "2026-01-28T10:30:00Z"   │
│ }                                        │
└──────────────────────────────────────────┘
```

## Upload Flow (When User Uploads Document)

```
User Uploads File
(test.txt, 5KB)
    │
    ▼
┌────────────────────────────┐
│ Receive File               │
│ filename: "test.txt"       │
│ mimetype: "text/plain"     │
│ buffer: [Buffer data]      │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Extract Text               │
│ Based on mimetype:         │
│ - text/* → UTF-8 decode    │
│ - .pdf → PDF parser        │
│ - .docx → Word parser      │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│ Split into Chunks                  │
│                                    │
│ Chunk 1: "The Amazon is..." (500c) │
│ Chunk 2: "...rainforest. It..." (500c)
│ Chunk 3: "...covers..." (300c)     │
│                                    │
│ (with 100 char overlap)            │
└────────┬───────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Generate Embeddings (For Each Chunk)     │
│                                          │
│ Chunk 1 → [0.234, 0.567, ...]        │
│ Chunk 2 → [0.345, 0.432, ...]        │
│ Chunk 3 → [0.123, 0.789, ...]        │
│                                          │
│ Model: nomic-embed-text                 │
│ Speed: ~10ms per chunk                  │
│ Dims: 384                               │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Store in Memory Map                      │
│                                          │
│ {                                        │
│   "doc-uuid": {                          │
│     id: "doc-uuid",                      │
│     name: "test.txt",                    │
│     size: 5000,                          │
│     type: "text/plain",                  │
│     content: "The Amazon is...",        │
│     chunks: [                            │
│       {                                  │
│         id: "chunk-uuid-1",              │
│         documentId: "doc-uuid",          │
│         content: "The Amazon is...",    │
│         embedding: [0.234, ...],         │
│         chunkIndex: 0                    │
│       },                                 │
│       { ... more chunks ... }            │
│     ]                                    │
│   }                                      │
│ }                                        │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Return Success Response          │
│                                  │
│ {                                │
│   "id": "doc-uuid",              │
│   "name": "test.txt",            │
│   "size": 5000,                  │
│   "type": "text/plain",          │
│   "status": "ready"              │
│ }                                │
└──────────────────────────────────┘
```

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
└─────────────────────────────────────────────────────────────────┘
         │                           │                         │
         ▼                           ▼                         ▼
    ┌─────────┐              ┌──────────────┐        ┌──────────────┐
    │ Browser │              │ Mobile App   │        │ CLI Tools    │
    │ (Web UI)│              │              │        │              │
    └────┬────┘              └───────┬──────┘        └───────┬──────┘
         │                          │                        │
         └──────────────┬───────────┴────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────────────┐
         │   FastAPI Server                     │
         │   http://localhost:3000              │
         └──────────┬───────────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
    /health    /api/rag/*    /api/booking/*
        │           │           │
        ▼           ▼           ▼
   (health) ┌─────────────┐  (booking)
            │ RAG Routes  │
            │  (upload)   │
            │  (query)    │
            │  (delete)   │
            └──────┬──────┘
                   │
                   ▼
          ┌─────────────────────┐
          │  RAG Service        │
          │  (business logic)   │
          └──────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ Extract &    │ │ Local Memory │ │ Ollama Client  │
│ Chunk Text   │ │ Map Storage  │ │                │
└──────────────┘ └──────────────┘ └────────┬───────┘
                                           │
                          ┌────────────────┼────────────────┐
                          │                │                │
                          ▼                ▼                ▼
                    ┌────────────┐  ┌────────────┐  ┌──────────────┐
                    │ Embedding  │  │ LLM Model  │  │ Ollama       │
                    │ Model      │  │ (gemma2)   │  │ Server       │
                    │nomic-embed │  │            │  │              │
                    │-text       │  │            │  │ llm/generate │
                    └────────────┘  └────────────┘  │ llm/embed    │
                                                    └──────────────┘
```

## Data Structure Example

When you upload a document, here's what gets stored:

```typescript
// Document stored in memory map
{
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "amazon.txt",
  size: 2500,
  type: "text/plain",
  content: "The Amazon Rainforest is the world's largest...",
  uploadedAt: Date,
  chunks: [
    {
      id: "chunk-1-uuid",
      documentId: "doc-uuid",
      content: "The Amazon Rainforest is the world's largest tropical...",
      embedding: [0.234, 0.567, 0.891, ...384 dimensions...],
      chunkIndex: 0
    },
    {
      id: "chunk-2-uuid",
      documentId: "doc-uuid",
      content: "...rainforest by area. It is located in South America...",
      embedding: [0.345, 0.432, 0.123, ...384 dimensions...],
      chunkIndex: 1
    },
    // More chunks...
  ]
}
```

## Cosine Similarity Calculation

When finding relevant chunks:

```
Question: "What is the Amazon?"
Question Embedding: [0.5, 0.3, 0.8, ...]

Chunk 1 Embedding: [0.4, 0.35, 0.75, ...]
Similarity = (0.5×0.4 + 0.3×0.35 + 0.8×0.75 + ...) / (||Q|| × ||C1||)
           = 0.87 ✓✓✓ (Very Relevant!)

Chunk 2 Embedding: [0.1, 0.2, 0.1, ...]
Similarity = ... = 0.34 (Less Relevant)

Chunk 3 Embedding: [0.5, 0.3, 0.8, ...]
Similarity = ... = 0.99 ✓✓✓✓ (Most Relevant!)
```

Top 5 chunks selected and used as context.

## Memory Usage Example

For a 10MB document:
- Text extraction: 10MB
- Split into chunks: 20,000 chunks (500 char each)
- Embeddings: 20,000 × 384 floats = ~31MB
- Chunk storage: ~10MB
- **Total: ~51MB per document**

For production, use a vector database instead of memory!
