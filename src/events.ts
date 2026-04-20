export type RenderResponse = {
  status: number;
  headers?: Record<string, string>;
  body: string;
  set_cookies?: string[];
};

export type IncomingRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

export type SseEvent =
  | { type: "request"; request: IncomingRequest }
  | { type: "llm_request"; model: string; messages: unknown; tools: unknown }
  | { type: "llm_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "state_write"; file: "state.md" | "sessions.json"; diff: string }
  | { type: "render"; response: RenderResponse }
  | { type: "error"; message: string };
