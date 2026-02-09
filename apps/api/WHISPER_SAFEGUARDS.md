# Voice Agent - Whisper Integration with Cost Safeguards

## Overview

The voice agent uses **OpenAI Whisper API** for speech-to-text transcription. To prevent unexpected charges, multiple safeguards are built into the system.

## Cost Safeguards

### 1. **Monthly Budget Limit**
- Default: **$10/month**
- Configured via `WHISPER_MONTHLY_LIMIT` environment variable
- System automatically blocks transcription when limit is reached
- Check in `.env`: `WHISPER_MONTHLY_LIMIT=10`

### 2. **Pre-Call Quota Check**
Before transcribing any audio, the system:
- Checks current month's usage
- Estimates cost for the incoming audio
- **Rejects the call if it would exceed the monthly limit**
- Returns detailed error with remaining budget

### 3. **Daily Usage Tracking**
- Tracks minutes of audio transcribed per day
- Tracks number of API calls per day
- Stores estimated daily cost
- Accessible via database table `whisper_usage`

### 4. **Detailed Cost Estimation**
- **Whisper pricing**: $0.02 per minute of audio
- All costs are estimated before making API calls
- Actual costs are logged for audit purposes

### 5. **Database Tracking**
Three database tables track all usage:
- `whisper_quota` - Monthly aggregated usage
- `whisper_usage` - Daily usage breakdown
- `voice_call` - Individual call records with transcripts

## API Endpoints

### Check Current Month Usage
```
GET /api/voice/quota
```

Response:
```json
{
  "monthYear": "2026-02",
  "minutesUsed": 2.5,
  "estimatedCost": 0.05,
  "requestCount": 5,
  "monthlyLimitUSD": 10,
  "remainingBudget": 9.95,
  "isLimited": false
}
```

### Start Voice Call
```
POST /api/voice/start
```

Response:
```json
{
  "callId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "initiated",
  "websocketUrl": "/voice/550e8400-e29b-41d4-a716-446655440000"
}
```

### WebSocket Message: Check Quota During Call
Send message type: `quota`
```json
{
  "type": "quota"
}
```

Response:
```json
{
  "type": "quota",
  "data": {
    "monthYear": "2026-02",
    "minutesUsed": 2.5,
    "estimatedCost": 0.05,
    "requestCount": 5,
    "monthlyLimitUSD": 10,
    "remainingBudget": 9.95,
    "isLimited": false
  }
}
```

### WebSocket Message: Send Audio for Transcription
```json
{
  "type": "audio",
  "audio": <base64_encoded_audio>,
  "durationSeconds": 10
}
```

Response on success:
```json
{
  "type": "transcript",
  "role": "user",
  "text": "I would like to book an appointment",
  "costEstimate": 0.0033,
  "timestamp": "2026-02-09T03:48:02.141Z"
}
```

Response on quota exceeded:
```json
{
  "type": "error",
  "message": "Quota exceeded: Monthly quota exceeded. Used $10.50 of $10",
  "quotaStatus": {
    "isAllowed": false,
    "reason": "Monthly quota exceeded. Used $10.50 of $10",
    "currentMonthUsage": {
      "minutesUsed": 525,
      "estimatedCost": 10.50,
      "remainingBudget": 0
    }
  }
}
```

## How to Monitor Usage

### 1. Via Database Queries
```sql
-- Check current month usage
SELECT * FROM whisper_quota 
WHERE month_year = '2026-02';

-- Check daily breakdown
SELECT * FROM whisper_usage 
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;

-- Check individual calls
SELECT call_id, duration_seconds, cost_estimate, created_at 
FROM voice_call
WHERE created_at >= CURRENT_DATE
ORDER BY created_at DESC;
```

### 2. Via API Endpoint
```bash
curl http://localhost:3001/api/voice/quota
```

### 3. Enable Detailed Logging
Add to `.env`:
```bash
LOG_LEVEL=debug
```

Logs will show:
```
📢 Transcribing audio: 10s (~$0.0033)
✅ Transcription complete. Monthly cost so far: $0.05/$10
```

## Safeguard Features

| Feature | Behavior |
|---------|----------|
| **Quota Check** | Blocks transcription if monthly limit would be exceeded |
| **Cost Estimation** | Shows estimated cost before making API call |
| **File Size Limit** | Rejects audio files larger than 25MB |
| **Duration Limit** | Rejects audio longer than 1 hour |
| **Usage Tracking** | Logs all calls with duration and cost |
| **Monthly Aggregate** | Tracks total spending and request count per month |
| **Daily Breakdown** | Shows daily usage patterns |

## Configuration

### Set Monthly Budget
Edit `.env`:
```bash
WHISPER_MONTHLY_LIMIT=20  # Increase to $20/month
```

### Get Current Configuration
```bash
# Check via environment variable
echo $WHISPER_MONTHLY_LIMIT

# Check via API (returns current usage)
curl http://localhost:3001/api/voice/quota | jq '.monthlyLimitUSD'
```

## Troubleshooting

### "Quota exceeded" error
1. Check current usage: `curl http://localhost:3001/api/voice/quota`
2. Increase limit if needed: Edit `WHISPER_MONTHLY_LIMIT` in `.env` and restart server
3. Wait for next month (quotas reset monthly)

### "Audio duration too long" error
- Maximum allowed: 1 hour (3600 seconds)
- Split longer audio into multiple files

### "File too large" error
- Maximum allowed: 25MB
- Reduce audio quality or split into smaller chunks

## Pricing

- **Whisper API**: $0.02 per minute
- **Examples**:
  - 5-minute call: $0.10
  - 30-minute call: $0.60
  - 100 calls (1 min each): $2.00

## Next Steps

1. **Frontend Integration**: Add Whisper service client to web app
2. **Text-to-Speech (TTS)**: Add response audio generation
3. **Call Recording**: Implement audio file storage
4. **Analytics Dashboard**: Add UI to monitor usage in real-time
