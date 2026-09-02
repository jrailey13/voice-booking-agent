import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { DocumentUpload, UploadedFile } from "@/components/rag/DocumentUpload";
import { Message } from "@/components/chat/ChatMessage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileSearch } from "lucide-react";
import { useRagQuery, useDocumentUpload, useDocumentDelete } from "@/hooks/useRagQuery";
import { useToast } from "@/hooks/use-toast";

export default function RagDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  
  const { toast } = useToast();
  const ragQuery = useRagQuery();
  const uploadDocument = useDocumentUpload();
  const deleteDocument = useDocumentDelete();

  const handleUpload = async (newFiles: File[]) => {
    for (const file of newFiles) {
      try {
        const response = await uploadDocument.mutateAsync(file);
        const uploadedFile: UploadedFile = {
          id: response.id,
          name: response.name,
          size: response.size,
          type: response.type,
        };
        setFiles((prev) => [...prev, uploadedFile]);
        
        toast({
          title: "Document uploaded",
          description: `${file.name} has been uploaded successfully.`,
        });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: `Failed to upload ${file.name}. Please try again.`,
          variant: "destructive",
        });
      }
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    try {
      await deleteDocument.mutateAsync(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      
      toast({
        title: "Document removed",
        description: "The document has been removed successfully.",
      });
    } catch (error) {
      toast({
        title: "Remove failed",
        description: "Failed to remove the document. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async (content: string) => {
    // The query endpoint requires at least one document to search against.
    // Guard here so an empty-fileIds request never reaches the API as a
    // cryptic "Query failed" — tell the user what to do instead.
    if (files.length === 0) {
      toast({
        title: "No documents yet",
        description: "Upload a document before asking a question.",
      });
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const fileIds = files.map((f) => f.id);
      const response = await ragQuery.mutateAsync({
        question: content,
        fileIds,
      });
      
      const assistantMessage: Message = {
        id: response.id,
        role: "assistant",
        content: response.answer,
        timestamp: new Date(response.timestamp),
        sources: response.sources,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      toast({
        title: "Query failed",
        description: "Failed to get a response. Please try again.",
        variant: "destructive",
      });
      
      // Remove the user message if the query failed
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <Layout>
      <div className="container py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg gradient-bg flex items-center justify-center">
              <FileSearch className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">RAG Document Tool</h1>
              <p className="text-muted-foreground">Upload documents and ask questions</p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-6 h-[calc(100vh-220px)]">
          {/* Documents Panel */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Documents</CardTitle>
              <CardDescription>Upload files to query against</CardDescription>
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)]">
              <DocumentUpload
                files={files}
                onUpload={handleUpload}
                onRemove={handleRemoveFile}
              />
            </CardContent>
          </Card>

          {/* Chat Panel */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Chat</CardTitle>
              <CardDescription>
                {files.length > 0
                  ? `Ask questions about your ${files.length} document${files.length > 1 ? "s" : ""}`
                  : "Upload documents to start asking questions"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ChatInterface
                messages={messages}
                onSend={handleSendMessage}
                isTyping={isTyping}
                showSources={true}
                disabled={files.length === 0}
                placeholder={
                  files.length > 0
                    ? "Ask a question about your documents..."
                    : "Upload documents first to start chatting"
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
