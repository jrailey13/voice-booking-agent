# API Integration Guide

This document describes how the frontend integrates with the backend REST API.

## Overview

The application has been configured to connect to a REST backend with the following architecture:

- **API Client Layer**: Centralized in `src/lib/api.ts`
- **React Query Hooks**: Custom hooks in `src/hooks/` for data fetching
- **WebSocket Connection**: Real-time voice features in `src/lib/websocket.ts`
- **Environment Configuration**: `.env.development` and `.env.production`

## API Endpoints

### RAG Document Tool

#### Upload Document
```
POST /api/rag/upload
Content-Type: multipart/form-data

Request Body:
- file: File (PDF, TXT, DOCX)

Response:
{
  "id": "string",
  "name": "string",
  "size": number,
  "type": "string",
  "status": "processing" | "ready" | "failed"
}
```

#### Query Documents
```
POST /api/rag/query
Content-Type: application/json

Request Body:
{
  "question": "string",
  "fileIds": ["string", ...]
}

Response:
{
  "id": "string",
  "answer": "string",
  "timestamp": "ISO8601 string",
  "sources": [
    {
      "title": "string",
      "snippet": "string"
    }
  ]
}
```

#### Delete Document
```
DELETE /api/rag/documents/{fileId}

Response: 204 No Content
```

### Booking Agent

#### Check Availability
```
GET /api/booking/availability?date=YYYY-MM-DD

Response:
{
  "date": "YYYY-MM-DD",
  "availableSlots": [
    {
      "time": "HH:MM AM/PM",
      "available": boolean
    }
  ]
}
```

#### Create Appointment
```
POST /api/booking/appointments
Content-Type: application/json

Request Body:
{
  "date": "YYYY-MM-DD",
  "time": "HH:MM AM/PM",
  "service": "string"
}

Response:
{
  "id": "string",
  "date": "YYYY-MM-DD",
  "time": "HH:MM AM/PM",
  "service": "string",
  "status": "confirmed" | "pending" | "cancelled"
}
```

#### Get Appointments
```
GET /api/booking/appointments

Response:
[
  {
    "id": "string",
    "date": "YYYY-MM-DD",
    "time": "HH:MM AM/PM",
    "service": "string",
    "status": "confirmed" | "pending" | "cancelled"
  }
]
```

#### Send Chat Message
```
POST /api/booking/chat
Content-Type: application/json

Request Body:
{
  "message": "string",
  "conversationId": "string" (optional)
}

Response:
{
  "id": "string",
  "message": "string",
  "timestamp": "ISO8601 string",
  "conversationId": "string"
}
```

### Voice Agent

#### Start Voice Call
```
POST /api/voice/start
Content-Type: application/json

Response:
{
  "callId": "string",
  "status": "initiated" | "connected" | "ended",
  "websocketUrl": "string"
}
```

#### End Voice Call
```
POST /api/voice/end
Content-Type: application/json

Request Body:
{
  "callId": "string"
}

Response: 204 No Content
```

## WebSocket Protocol

### Voice Agent WebSocket

Connect to: `ws://localhost:3001/api/voice/{callId}`

#### Server -> Client Messages

**Transcript Message:**
```json
{
  "type": "transcript",
  "role": "user" | "assistant",
  "text": "string",
  "timestamp": "ISO8601 string"
}
```

**State Change Message:**
```json
{
  "type": "state",
  "state": "connected" | "speaking" | "listening" | "ended"
}
```

#### Client -> Server Messages

The client can send control messages:
```json
{
  "type": "mute",
  "muted": boolean
}
```

## Environment Configuration

### Development
Create `.env.development`:
```env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/api
```

### Production
Create `.env.production`:
```env
VITE_API_URL=https://api.yourservice.com
VITE_WS_URL=wss://api.yourservice.com
```

## Error Handling

All API calls include try-catch error handling with user-friendly toast notifications. The error responses should follow this format:

```json
{
  "error": "string",
  "message": "string",
  "statusCode": number
}
```

## Component Updates

### RagDemo Component
- ✅ Uses `useRagQuery()`, `useDocumentUpload()`, `useDocumentDelete()` hooks
- ✅ Real API integration for document upload, query, and deletion
- ✅ Toast notifications for success/failure

### SimpleBooking Component
- ✅ Uses `useAvailability()`, `useCreateAppointment()`, `useAppointments()` hooks
- ✅ Calendar-based date/time selection against live availability
- ✅ Toast notifications for success and errors

### VoiceAgent Component
- ✅ Uses `useStartCall()`, `useEndCall()` hooks
- ✅ Real-time WebSocket connection for live transcription
- ✅ Proper cleanup on disconnect

## Testing the Integration

1. **Start your backend server** (should run on `http://localhost:3001`)

2. **Update environment variables** if your backend runs on a different port

3. **Start the frontend**:
   ```bash
   npm run dev
   ```

4. **Test each feature**:
   - RAG Demo: Upload a document and ask questions
   - Booking: Pick a date and time and confirm an appointment
   - Voice Agent: Start a call and test real-time transcription

## Backend Implementation Checklist

To fully integrate, your backend needs to implement:

- [ ] RAG document upload, storage, and processing
- [ ] RAG query endpoint with vector search
- [ ] Booking conversation logic (NLP/LLM integration)
- [ ] Appointment management (CRUD operations)
- [ ] Voice call WebSocket server
- [ ] Real-time speech-to-text and text-to-speech
- [ ] CORS configuration for frontend origin
- [ ] Authentication/Authorization (if needed)

## CORS Configuration

Your backend should allow requests from the frontend origin:

```javascript
// Example Express.js configuration
app.use(cors({
  origin: 'http://localhost:5173', // Vite dev server
  credentials: true
}));
```

## Next Steps

1. Implement the backend API endpoints
2. Set up a vector database for RAG (e.g., Pinecone, Weaviate, ChromaDB)
3. Integrate an LLM for conversation (e.g., OpenAI, Claude, Azure OpenAI)
4. Set up speech services for voice agent (e.g., Azure Speech, Google Speech)
5. Deploy both frontend and backend
6. Configure production environment variables
