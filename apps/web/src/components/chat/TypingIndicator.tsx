import { Bot } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex gap-3 p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full gradient-bg">
        <Bot className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="flex items-center gap-1 bg-muted rounded-2xl rounded-bl-md px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-typing" style={{ animationDelay: "0s" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-typing" style={{ animationDelay: "0.2s" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-typing" style={{ animationDelay: "0.4s" }} />
      </div>
    </div>
  );
}
