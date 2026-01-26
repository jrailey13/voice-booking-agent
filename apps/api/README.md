# AI Services API

Node.js/TypeScript backend using Fastify.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your API keys.

3. **Run development server:**
   ```bash
   npm run dev
   ```

   Server will start at `http://localhost:3000`

## Project Structure

```
src/
├── index.ts              # Main server setup
├── routes/               # API route handlers
│   ├── rag.ts           # RAG document endpoints
│   ├── booking.ts       # Booking agent endpoints
│   └── voice.ts         # Voice call endpoints + WebSocket
└── services/            # Business logic
    ├── rag.service.ts   # RAG implementation
    ├── booking.service.ts # Booking logic
    └── voice.service.ts # Voice processing
```

## Available Endpoints

### RAG Routes (`/api/rag`)
- `POST /upload` - Upload document
- `POST /query` - Query documents
- `DELETE /documents/:fileId` - Delete document

### Booking Routes (`/api/booking`)
- `GET /availability?date=YYYY-MM-DD` - Check availability
- `POST /appointments` - Create appointment
- `GET /appointments` - List appointments
- `POST /chat` - Chat with booking agent

### Voice Routes (`/api/voice`)
- `POST /start` - Start voice call
- `POST /end` - End voice call
- `WS /:callId` - WebSocket for real-time voice

## Implementation TODO

Each service has mock implementations. To complete:

### RAG Service (`src/services/rag.service.ts`)
- [ ] Add document text extraction (PDF, DOCX, TXT)
- [ ] Integrate vector database (Pinecone, Weaviate, ChromaDB)
- [ ] Implement embedding generation
- [ ] Connect to LLM (OpenAI, Claude, Azure OpenAI)

### Booking Service (`src/services/booking.service.ts`)
- [ ] Add database for appointments (PostgreSQL, MongoDB)
- [ ] Implement conversational AI (OpenAI GPT-4, Claude)
- [ ] Add calendar integration
- [ ] Email notifications

### Voice Service (`src/services/voice.service.ts`)
- [ ] Implement speech-to-text (Azure Speech, Google Speech, Whisper)
- [ ] Implement text-to-speech (Azure TTS, Google TTS, ElevenLabs)
- [ ] Real-time audio streaming
- [ ] Integrate with booking AI

## Development

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Environment Variables

See `.env.example` for required configuration.

Key variables:
- `PORT` - Server port (default: 3000)
- `OPENAI_API_KEY` - OpenAI API key for LLM
- `AZURE_SPEECH_KEY` - Azure Speech Services key
- `CORS_ORIGIN` - Allowed frontend origin
