import readline from "readline"

/**
 * The only seam that touches the terminal. Tools (ask_user) and the approval
 * flow talk to the human through this, so tests can substitute a fake.
 */
export interface AgentIO {
  prompt(question: string): Promise<string>
  print(text: string): void
}

export interface ConsoleIO extends AgentIO {
  close(): void
}

export function createConsoleIO(): ConsoleIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return {
    prompt: (question) => new Promise((resolve) => rl.question(question, resolve)),
    print: (text) => console.log(text),
    close: () => rl.close(),
  }
}
