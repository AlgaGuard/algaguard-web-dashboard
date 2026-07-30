export type RealtimeState =
  "disconnected" | "connecting" | "connected" | "recovering";

export function organizationTelemetrySubscriptions(organizationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId))
    throw new Error("Organization context unavailable");
  return [
    {
      resourceType: "organization" as const,
      resourceId: organizationId,
      events: ["telemetry.updated"],
    },
    {
      resourceType: "current-user" as const,
      events: ["system.notification"],
    },
  ];
}

export class RealtimeClient {
  private socket?: WebSocket;
  private attempt = 0;
  private stopped = false;
  constructor(
    private readonly ticket: () => Promise<string>,
    private readonly recover: () => Promise<void>,
    private readonly onEvent: (value: unknown) => void,
    private readonly onState: (state: RealtimeState) => void,
    private readonly subscriptions: () => Promise<
      Array<{
        resourceType: "organization" | "device" | "current-user";
        resourceId?: string;
        events: string[];
      }>
    > = async () => [
      { resourceType: "current-user", events: ["system.notification"] },
    ],
  ) {}
  async connect() {
    this.stopped = false;
    this.onState("connecting");
    const ticket = await this.ticket();
    const base =
      import.meta.env.VITE_WEBSOCKET_URL ?? "ws://localhost:8080/realtime";
    this.socket = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`);
    this.socket.onopen = async () => {
      this.attempt = 0;
      this.onState("recovering");
      await this.recover();
      this.socket?.send(
        JSON.stringify({
          schema: "algaguard.websocket.subscribe",
          schemaVersion: "1.0.0",
          requestId: crypto.randomUUID(),
          subscriptions: await this.subscriptions(),
        }),
      );
      this.onState("connected");
    };
    this.socket.onmessage = (event) =>
      this.onEvent(JSON.parse(String(event.data)));
    this.socket.onclose = () => void this.reconnect();
    this.socket.onerror = () => this.onState("disconnected");
  }
  stop() {
    this.stopped = true;
    this.socket?.close();
  }
  private async reconnect() {
    if (this.stopped) return;
    this.onState("disconnected");
    const delay =
      Math.min(30_000, 500 * 2 ** this.attempt++) + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.connect().catch(() => this.onState("disconnected"));
  }
}
