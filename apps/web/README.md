# Voice Booking Agent — Web

React + Vite single-page app for the Voice Booking Agent. It provides the
voice call UI, calendar booking, and document Q&A demos, and talks to the
Fastify API in `apps/api` over REST and a WebSocket.

See the [root README](../../README.md) for the full project overview,
architecture, and setup instructions.

## Develop

```sh
npm install
npm run dev      # http://localhost:8080
```

The API must be running (`cd ../api && npm run dev`) for the app to function.

## Stack

- Vite
- TypeScript
- React
- shadcn/ui
- Tailwind CSS
