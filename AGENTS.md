# Repository working rules

- Use React, TypeScript, Vite, React Router, TanStack Query, and the native WebSocket client.
- Keep REST authoritative for initial/history/recovery state and HTTPS for commands; WebSocket is live updates only.
- Never log or persist access tokens or Wi-Fi credentials. Do not use Firebase or Socket.IO.
- Keep keyboard navigation, responsive states, error/loading/empty states, and simulated-data labels visible.
