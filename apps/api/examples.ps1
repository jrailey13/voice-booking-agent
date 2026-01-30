#!/usr/bin/env powershell
# Example requests for Ollama RAG API
# Run these in PowerShell after starting the API with: npm run dev

$API_BASE = "http://localhost:3000"

Write-Host "================================" -ForegroundColor Green
Write-Host "Ollama RAG API Examples" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green

# 1. Health Check
Write-Host "`n1. Health Check" -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "$API_BASE/health" -Method GET
Write-Host "Status: $($health.status)" -ForegroundColor Green

# 2. Create a test document
Write-Host "`n2. Creating test document..." -ForegroundColor Yellow
$testContent = @"
The Amazon Rainforest is the world's largest tropical rainforest by area. 
It is located in South America and covers approximately 5.5 million square kilometers.
The rainforest is home to millions of species of plants and animals.
It produces about 20% of the world's oxygen and is vital for climate regulation.
"@

$testContent | Out-File -FilePath "test-doc.txt" -Encoding UTF8
Write-Host "   ✓ Created test-doc.txt" -ForegroundColor Green

# 3. Upload Document
Write-Host "`n3. Uploading document..." -ForegroundColor Yellow
$uploadResponse = @{
    file = Get-Item "test-doc.txt"
} | ForEach-Object {
    $form = @{
        file = $_.file
    }
    Invoke-RestMethod -Uri "$API_BASE/api/rag/upload" -Method POST -Form $form -ContentType "multipart/form-data"
}

$documentId = $uploadResponse.id
Write-Host "   ✓ Document uploaded" -ForegroundColor Green
Write-Host "   ID: $documentId" -ForegroundColor Cyan
Write-Host "   Name: $($uploadResponse.name)" -ForegroundColor Cyan
Write-Host "   Status: $($uploadResponse.status)" -ForegroundColor Cyan

# 4. Query Document
Write-Host "`n4. Querying document..." -ForegroundColor Yellow
$question = "What is the Amazon Rainforest and why is it important?"

$queryPayload = @{
    question = $question
    fileIds = @($documentId)
} | ConvertTo-Json

Write-Host "   Question: $question" -ForegroundColor Cyan
Write-Host "   Processing..." -ForegroundColor Yellow

$queryResponse = Invoke-RestMethod `
    -Uri "$API_BASE/api/rag/query" `
    -Method POST `
    -ContentType "application/json" `
    -Body $queryPayload

Write-Host "   ✓ Query complete" -ForegroundColor Green
Write-Host "   Answer: $($queryResponse.answer)" -ForegroundColor Cyan
Write-Host "   Sources:" -ForegroundColor Cyan
$queryResponse.sources | ForEach-Object {
    Write-Host "     - $($_.title)" -ForegroundColor Gray
}

# 5. Query with Multiple Questions
Write-Host "`n5. Asking follow-up questions..." -ForegroundColor Yellow
$questions = @(
    "How much oxygen does the Amazon produce?",
    "What species live in the Amazon?",
    "What is the size of the Amazon Rainforest?"
)

foreach ($q in $questions) {
    Write-Host "   Q: $q" -ForegroundColor Cyan
    
    $payload = @{
        question = $q
        fileIds = @($documentId)
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod `
        -Uri "$API_BASE/api/rag/query" `
        -Method POST `
        -ContentType "application/json" `
        -Body $payload
    
    Write-Host "   A: $($response.answer)" -ForegroundColor Green
    Write-Host ""
}

# 6. Delete Document
Write-Host "`n6. Cleaning up..." -ForegroundColor Yellow
Invoke-RestMethod `
    -Uri "$API_BASE/api/rag/documents/$documentId" `
    -Method DELETE `
    -ErrorAction SilentlyContinue

Write-Host "   ✓ Document deleted" -ForegroundColor Green

# 7. Cleanup test file
Remove-Item -Path "test-doc.txt" -Force
Write-Host "   ✓ Test file cleaned up" -ForegroundColor Green

Write-Host "`n================================" -ForegroundColor Green
Write-Host "✓ All examples completed!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
