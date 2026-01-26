import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface RagQueryParams {
  question: string;
  fileIds: string[];
}

interface RagQueryResponse {
  id: string;
  answer: string;
  timestamp: string;
  sources?: Array<{
    title: string;
    snippet: string;
  }>;
}

export const useRagQuery = (): UseMutationResult<RagQueryResponse, Error, RagQueryParams> => {
  return useMutation({
    mutationFn: ({ question, fileIds }: RagQueryParams) => 
      api.rag.query(question, fileIds),
  });
};

interface DocumentUploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processing' | 'ready' | 'failed';
}

export const useDocumentUpload = (): UseMutationResult<DocumentUploadResponse, Error, File> => {
  return useMutation({
    mutationFn: (file: File) => api.rag.uploadDocument(file),
  });
};

export const useDocumentDelete = (): UseMutationResult<void, Error, string> => {
  return useMutation({
    mutationFn: (fileId: string) => api.rag.deleteDocument(fileId),
  });
};
