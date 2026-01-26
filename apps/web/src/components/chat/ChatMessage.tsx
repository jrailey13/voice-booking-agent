import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: { title: string; snippet: string }[];
}

interface ChatMessageProps {
  message: Message;
  showSources?: boolean;
}

export function ChatMessage({ message, showSources = false }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 p-4",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "gradient-bg"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary-foreground" />
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-2 max-w-[80%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted rounded-bl-md"
          )}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        {showSources && message.sources && message.sources.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-xs text-muted-foreground font-medium">Sources:</span>
            {message.sources.map((source, idx) => (
              <div
                key={idx}
                className="text-xs bg-secondary/50 rounded-md px-2 py-1 border"
              >
                <span className="font-medium">{source.title}</span>
                <p className="text-muted-foreground line-clamp-2">{source.snippet}</p>
              </div>
            ))}
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
