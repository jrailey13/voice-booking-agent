/**
 * Test fakes for the RAG pipeline, shared by the contract and unit tests.
 *
 * - fakeOllama: a fetch() that answers Ollama's HTTP API (/api/embed, /api/generate,
 *   /api/chat). Both the `ollama` client and @langchain/ollama go through fetch, so
 *   one fake covers either implementation.
 * - FakeRagDb: an in-memory stand-in for the Prisma models RAG touches, accepting
 *   the query shapes either implementation uses (nested create, createMany,
 *   $transaction, findMany with include/select).
 */

export const EMBED_DIMS = 64

/** Bag-of-words embedding: words hash into buckets, so cosine similarity tracks word overlap. */
export function embedText(text: string): number[] {
  const v = new Array(EMBED_DIMS).fill(0)
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0
    for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0
    v[h % EMBED_DIMS] += 1
  }
  return v
}

export interface LlmRequest {
  system: string
  user: string
}

export interface FakeOllama {
  fetch: typeof fetch
  answer: string
  /** Every generation request, normalised across /api/generate and /api/chat. */
  llmRequests: LlmRequest[]
  embedCalls: number
  failEmbeddings: boolean
  reset(): void
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const ndjson = (lines: unknown[]) =>
  new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })

export function createFakeOllama(): FakeOllama {
  const state: FakeOllama = {
    answer: 'FAKE ANSWER',
    llmRequests: [],
    embedCalls: 0,
    failEmbeddings: false,
    reset() {
      state.answer = 'FAKE ANSWER'
      state.llmRequests = []
      state.embedCalls = 0
      state.failEmbeddings = false
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const now = new Date().toISOString()

      if (url.endsWith('/api/embed')) {
        state.embedCalls++
        if (state.failEmbeddings) return new Response(JSON.stringify({ error: 'embed failed' }), { status: 500 })
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input]
        return json({ model: body.model, embeddings: inputs.map(embedText) })
      }

      if (url.endsWith('/api/generate')) {
        state.llmRequests.push({ system: body.system ?? '', user: body.prompt ?? '' })
        const done = { model: body.model, created_at: now, response: state.answer, done: true, done_reason: 'stop' }
        return body.stream ? ndjson([done]) : json(done)
      }

      if (url.endsWith('/api/chat')) {
        const messages: Array<{ role: string; content: string }> = body.messages ?? []
        state.llmRequests.push({
          system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
          user: messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n'),
        })
        const message = { role: 'assistant', content: state.answer }
        const done = { model: body.model, created_at: now, message, done: true, done_reason: 'stop' }
        return body.stream === false
          ? json(done)
          : ndjson([{ model: body.model, created_at: now, message, done: false }, { ...done, message: { role: 'assistant', content: '' } }])
      }

      return new Response(JSON.stringify({ error: `fake ollama: unhandled ${url}` }), { status: 404 })
    }) as typeof fetch,
  }
  return state
}

interface DocRow { id: string; name: string; size: number; type: string; content: string }
interface ChunkRow { id: string; documentId: string; content: string; embedding: number[]; chunkIndex: number }
interface QueryLogRow { question: string; answer: string; sources: string[] }

type ChunkInput = Omit<ChunkRow, 'id' | 'documentId'> & { documentId?: string }

/** In-memory stand-in for prisma.ragDocument / ragChunk / queryLog / $transaction. */
export class FakeRagDb {
  documents: DocRow[] = []
  chunks: ChunkRow[] = []
  queryLogs: QueryLogRow[] = []
  failNextWrite = false
  private seq = 0

  private nextId = () => `row${++this.seq}`

  private assertWritable() {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('fake db: write failed')
    }
  }

  private insertChunks(rows: ChunkInput[], documentId?: string) {
    for (const r of rows) {
      const docId = documentId ?? r.documentId
      if (!docId || !this.documents.some((d) => d.id === docId)) throw new Error(`fake db: FK violation for ${docId}`)
      this.chunks.push({ id: this.nextId(), documentId: docId, content: r.content, embedding: r.embedding, chunkIndex: r.chunkIndex })
    }
  }

  ragDocument = {
    create: async ({ data }: { data: Partial<DocRow> & { chunks?: { createMany?: { data: ChunkInput[] } } } }) => {
      this.assertWritable()
      const { chunks, ...doc } = data
      const row: DocRow = { id: doc.id ?? this.nextId(), name: doc.name!, size: doc.size!, type: doc.type!, content: doc.content ?? '' }
      this.documents.push(row)
      if (chunks?.createMany) this.insertChunks(chunks.createMany.data, row.id)
      return row
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const doc = this.documents.find((d) => d.id === where.id)
      if (!doc) throw new Error('fake db: record to delete does not exist')
      this.documents = this.documents.filter((d) => d.id !== where.id)
      this.chunks = this.chunks.filter((c) => c.documentId !== where.id) // onDelete: Cascade
      return doc
    },
  }

  ragChunk = {
    createMany: async ({ data }: { data: ChunkInput[] }) => {
      this.assertWritable()
      this.insertChunks(data)
      return { count: data.length }
    },
    findMany: async ({ where }: { where?: { documentId?: { in?: string[] } } } = {}) => {
      const ids = where?.documentId?.in
      return this.chunks
        .filter((c) => !ids || ids.includes(c.documentId))
        .map((c) => ({ ...c, document: { name: this.documents.find((d) => d.id === c.documentId)?.name ?? '' } }))
    },
  }

  queryLog = {
    create: async ({ data }: { data: QueryLogRow }) => {
      this.queryLogs.push(data)
      return data
    },
  }

  /** Interactive transactions: all-or-nothing over the in-memory tables. */
  $transaction = async <T>(fn: (tx: FakeRagDb) => Promise<T>): Promise<T> => {
    const snapshot = { documents: [...this.documents], chunks: [...this.chunks] }
    try {
      return await fn(this)
    } catch (error) {
      this.documents = snapshot.documents
      this.chunks = snapshot.chunks
      throw error
    }
  }

  reset() {
    this.documents = []
    this.chunks = []
    this.queryLogs = []
    this.failNextWrite = false
  }
}
