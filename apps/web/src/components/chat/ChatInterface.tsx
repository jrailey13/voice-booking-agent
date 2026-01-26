import { useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage, Message } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";

interface ChatInterfaceProps {
  messages: Message[];
  onSend: (message: string) => void;
  isTyping?: boolean;
  showSources?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInterface({
  messages,
  onSend,
  isTyping = false,
  showSources = false,
  placeholder,
  className,
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div className="text-muted-foreground">
                <p className="text-lg font-medium">Start a conversation</p>
                <p className="text-sm">Send a message to begin</p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                showSources={showSources}
              />
            ))
          )}
          {isTyping && <TypingIndicator />}
        </div>
      </ScrollArea>
      <ChatInput onSend={onSend} disabled={isTyping} placeholder={placeholder} />
    </div>
  );
}
