# Retrieval (RAG) Service

Upload PDF, DOCX or text files, then ask questions that are answered only from those files, with citations. Everything runs locally on Ollama: `nomic-embed-text` for embeddings and `LLM_MODEL` (default `gemma3`) for answers. Documents never leave the machine.

The pipeline is built from **LangChain** parts. This page is also a map from LangChain concepts to the code. Setup steps are in [`apps/api/OLLAMA_RAG_SETUP.md`](apps/api/OLLAMA_RAG_SETUP.md), and the design and its decisions are in [`docs/langchain-architecture.md`](docs/langchain-architecture.md) (§5, ADR-004).

## API

```
POST   /api/rag/upload              multipart file → { id, name, size, type, status: "ready" | "failed" }
POST   /api/rag/query               { question, fileIds } → { id, answer, timestamp, sources: [{ title, snippet }] }
DELETE /api/rag/documents/:fileId   204
```

`status: "failed"` comes back with HTTP 200, and the web client relies on that.

## Upload: split, embed, store

```
file ─► extractText ─► RecursiveCharacterTextSplitter ─► OllamaEmbeddings.embedDocuments ─► $transaction(document row + chunk rows)
        lib/rag/extract.ts      (500 chars, 100 overlap)                                          lib/rag/ingest.ts
```

- **Text splitter.** `RecursiveCharacterTextSplitter` tries to split on paragraph breaks first, then lines, then words, and only cuts mid-word as a last resort. Chunks are therefore whole thoughts rather than fixed 500-character slices. Documents uploaded before this change keep their old chunks. They work unchanged, because the embedding model is the same.
- **Embeddings.** `OllamaEmbeddings` is LangChain's wrapper for Ollama's `/api/embed`.
- **All-or-nothing.** Embedding is slow, so it happens *before* the transaction. The document row and its chunks are then written together, so a failure anywhere leaves no partial document.

## Query: retrieve, then answer

`lib/rag/chain.ts` builds the query as an **LCEL** chain, LangChain's way of piping steps together:

```
{ question, fileIds }
  │ RunnablePassthrough.assign(docs = store.asRetriever({ k: 5, filter: { documentIds: fileIds } }))
  │ RunnableBranch
  │   ├─ no docs ─► { answer: "No relevant information found…", docs: [] }    (model not called)
  │   └─ else    ─► format context ─► ChatPromptTemplate ─► ChatOllama ─► StringOutputParser
  ▼
{ answer, docs }  ──►  service builds sources (one per document, best chunk as snippet) and logs the query
```

- **Vector store.** `PrismaVectorStore` (`lib/rag/prismaVectorStore.ts`) implements LangChain's `VectorStore` contract on the existing `rag_chunks` table. It provides `addVectors`, plus `similaritySearchVectorWithScore`, which ranks by cosine similarity. Because it meets the contract, it gets `similaritySearch` and `asRetriever` for free, and the chain does not know it is Postgres. A filter is required; without one it returns nothing rather than searching every document.
- **Retriever.** `asRetriever({ k, filter })` turns the store into a Runnable that maps a question to documents. It is created per request, so the filter can be that request's `fileIds`.
- **Prompt.** `ChatPromptTemplate` builds a system message (the "answer only from the context" instructions) and a human message (`Context: … Question: … Answer:`). Template variables are substituted, never parsed, so braces in documents are safe.
- **Branching.** `RunnableBranch` skips the model entirely when nothing is retrieved.
- **Config propagation.** A `RunnableLambda` that invokes another runnable must pass on the `config` it receives. Otherwise callbacks, tags and abort signals stop at the lambda. The chain does this for the retriever and the answer step, and a test pins it.

## Configuration

| Variable | Default |
|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` |
| `EMBEDDING_MODEL` | `nomic-embed-text` |
| `LLM_MODEL` | `gemma3` |

`DEBUG=true` prints each step of a query to the console through a LangChain callback handler (`lib/ai/stepTracer.ts`). It is the local alternative to LangSmith:

```
· retriever "What is this test document about?"
· retriever 1.8s → 1 docs (ragtest.txt)
· model     started (2 messages)
· model     24.6s → answer (56 chars)
```

The LangChain models are created with `maxRetries: 0`. LangChain's default is up to 6 retries with exponential backoff, which would make an Ollama outage hang a request for minutes instead of failing fast.

The API **refuses to start** if `LANGSMITH_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_TRACING`, `LANGSMITH_API_KEY` or `LANGCHAIN_API_KEY` is set, because they would send documents to LangSmith.

## Performance

On a CPU-only machine:
- An upload of about 1 KB takes about 1.5s.
- A query takes about 5–25s, almost all of it the answer generation.

Similarity is brute-force over the selected files' chunks, which is fine for a personal corpus. pgvector is the scaling path, and it would replace only `PrismaVectorStore`.

## Tests

```bash
cd apps/api && npm test
```

- `services/rag.service.test.ts`: **contract tests**. They pin the HTTP response shapes, the exact prompt, top-5 retrieval scoped to the requested files, the empty-result reply, logging and all-or-nothing uploads. They were written against the old hand-rolled service and pass unchanged on the LangChain version. Ollama is faked at the `fetch` level and Prisma in memory (`src/test/fakes.ts`).
- `lib/rag/*.test.ts`: unit tests for the store, ingestion and chain, using LangChain's `FakeListChatModel`, `FakeEmbeddings` and a deterministic bag-of-words embedder.
