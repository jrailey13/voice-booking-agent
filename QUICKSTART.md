# Quick Start - 3 Steps to Get Running

## 📋 Before You Start
- ✅ Ollama installed
- ✅ `gemma3` and `nomic-embed-text` pulled from Ollama
- ✅ You're in PowerShell

## Step 1️⃣ Start Ollama Server

Open a **new PowerShell window** and run:

```powershell
ollama serve
```

✓ You should see output like:
```
2026-01-28 10:00:00 Starting Ollama server...
2026-01-28 10:00:05 Listening on [::]:11434
```

**Keep this window open!**

## Step 2️⃣ Setup & Start API

In **another PowerShell window**, navigate to the API:

```powershell
cd c:\Users\jkr00\Documents\ai-services\apps\api
```

Run the setup check:

```powershell
.\quickstart.ps1
```

This will:
- ✓ Verify Ollama is running
- ✓ Check models are available
- ✓ Setup `.env` file
- ✓ Install dependencies

Start the API:

```powershell
npm run dev
```

✓ You should see:
```
🚀 Server listening on port 3000
```

## Step 3️⃣ Test with Examples

In a **third PowerShell window**:

```powershell
cd c:\Users\jkr00\Documents\ai-services\apps\api
.\examples.ps1
```

This will:
1. Create a sample document about the Amazon
2. Upload it to your RAG system
3. Ask multiple questions about it
4. Show answers with sources
5. Clean up

---

## 🎯 What Just Happened?

You've built a working RAG system that:
- 📄 **Accepts documents** (text files)
- 🔍 **Converts to vectors** using `nomic-embed-text`
- 🧠 **Understands questions** using embeddings
- 📊 **Finds relevant content** using similarity search
- 💬 **Generates answers** using `gemma3` LLM
- 📌 **Shows sources** where answers came from

---

## 📚 Learn More

- **Setup Details**: Read `OLLAMA_RAG_SETUP.md`
- **Architecture**: Read `ARCHITECTURE.md`
- **Code**: Check `src/lib/ollama.ts` and `src/services/rag.service.ts`

---

## 🐛 Troubleshooting

### Problem: "Cannot connect to Ollama"
```powershell
# Make sure Ollama is running in another window
ollama serve
```

### Problem: "Models not found"
```powershell
# Pull them
ollama pull nomic-embed-text
ollama pull gemma3
```

### Problem: "npm command not found"
- Make sure you're in `apps/api` directory
- Install Node.js if not already installed

### Problem: Port 3000 already in use
- Change PORT in `.env` to a different number
- Or kill the process: `Get-Process -Port 3000 | Stop-Process`

---

## 🚀 Next Steps

1. ✅ **Test with your own documents** - Upload .txt files
2. 📝 **Add PDF support** - `npm install pdf-parse`
3. 🗄️ **Add database** - PostgreSQL + pgvector
4. 🎨 **Connect to web UI** - Already set up in `apps/web`

---

## 📁 What Was Created

```
apps/api/
├── src/lib/ollama.ts           ← NEW: Ollama integration
├── src/services/rag.service.ts ← UPDATED: RAG logic
├── src/routes/rag.ts           ← Ready to use
├── .env.example                ← UPDATED: Config
├── OLLAMA_RAG_SETUP.md         ← Full guide
├── ARCHITECTURE.md             ← Visual diagrams
├── quickstart.ps1              ← Setup script
└── examples.ps1                ← Test script
```

---

## ✨ API Endpoints

Your API is now running at `http://localhost:3000`

### Upload Document
```powershell
$form = @{
    file = Get-Item "mydoc.txt"
}
Invoke-RestMethod -Uri "http://localhost:3000/api/rag/upload" `
    -Method POST `
    -Form $form
```

### Ask Question
```powershell
$payload = @{
    question = "What is...?"
    fileIds = @("doc-id-from-upload")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/rag/query" `
    -Method POST `
    -ContentType "application/json" `
    -Body $payload
```

### Delete Document
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/rag/documents/doc-id" `
    -Method DELETE
```

---

## 💡 Key Features

✅ **Completely Local** - No API keys, data stays on your machine
✅ **Fast Embeddings** - `nomic-embed-text` is ~10ms per chunk
✅ **Smart Chunking** - Overlapping chunks preserve context
✅ **Semantic Search** - Finds relevant content, not just keywords
✅ **Source Citations** - Know where answers come from
✅ **Error Handling** - Graceful failures with helpful messages

---

## 🎓 How It Works (Super Simple)

1. **Upload**: Break document into chunks, convert to numbers (embeddings)
2. **Store**: Save those numbers alongside the text
3. **Ask**: Convert question to numbers
4. **Find**: Compare question numbers to all document numbers
5. **Answer**: Use the 5 most similar chunks as context, ask LLM to answer

That's it! 🎉

---

## 📞 Questions?

Check the documentation files:
- `OLLAMA_RAG_SETUP.md` - Setup & troubleshooting
- `ARCHITECTURE.md` - How it works visually
- Code comments - Implementation details

Enjoy your RAG system! 🚀
