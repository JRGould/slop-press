import OpenAI from "openai";
import type { SseEvent } from "./events.js";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMTurn = {
  assistantMessage: ChatMessage;
  toolCalls: ToolCall[];
  finishReason: string | null;
};

export type LLMOptions = {
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  onEvent?: (event: SseEvent) => void;
};

let clientPromise: Promise<OpenAI> | null = null;

function getClient(): Promise<OpenAI> {
  if (clientPromise) return clientPromise;
  clientPromise = Promise.resolve(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    }),
  );
  return clientPromise;
}

export async function callLLM(opts: LLMOptions): Promise<LLMTurn> {
  const { model, messages, tools, onEvent } = opts;

  onEvent?.({ type: "llm_request", model, messages, tools });

  const client = await getClient();
  const stream = await client.chat.completions.create({
    model,
    messages: messages as never,
    tools: tools as never,
    tool_choice: "auto",
    stream: true,
  });

  let content = "";
  let finishReason: string | null = null;
  const toolCallBuf = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  const emittedToolCalls = new Set<number>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      onEvent?.({ type: "llm_delta", text: delta.content });
    }

    const reasoningText = extractReasoning(delta);
    if (reasoningText) {
      onEvent?.({ type: "thinking_delta", text: reasoningText });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCallBuf.get(idx) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCallBuf.set(idx, existing);
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  const toolCalls: ToolCall[] = [];
  const assistantToolCalls: NonNullable<
    Extract<ChatMessage, { role: "assistant" }>["tool_calls"]
  > = [];
  for (const [idx, tc] of [...toolCallBuf.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
    assistantToolCalls.push({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    });
    if (!emittedToolCalls.has(idx)) {
      emittedToolCalls.add(idx);
      let parsedArgs: unknown = tc.arguments;
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        // leave as raw string if not valid JSON
      }
      onEvent?.({
        type: "tool_call",
        id: tc.id,
        name: tc.name,
        args: parsedArgs,
      });
    }
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: content.length > 0 ? content : null,
    ...(assistantToolCalls.length > 0
      ? { tool_calls: assistantToolCalls }
      : {}),
  };

  return { assistantMessage, toolCalls, finishReason };
}

function extractReasoning(delta: unknown): string | null {
  if (!delta || typeof delta !== "object") return null;
  const d = delta as Record<string, unknown>;
  if (typeof d.reasoning === "string" && d.reasoning) return d.reasoning;
  if (typeof d.reasoning_content === "string" && d.reasoning_content)
    return d.reasoning_content;
  const thinking = d.thinking;
  if (typeof thinking === "string" && thinking) return thinking;
  if (thinking && typeof thinking === "object") {
    const t = thinking as Record<string, unknown>;
    if (typeof t.content === "string" && t.content) return t.content;
  }
  return null;
}

export function pickModel(opts: {
  isAdmin: boolean;
}): string {
  const override = process.env.SLOPPRESS_MODEL;
  if (opts.isAdmin) {
    return process.env.SLOPPRESS_MODEL_ADMIN ?? override ?? "gpt-4o-mini";
  }
  return process.env.SLOPPRESS_MODEL_READ ?? override ?? "gpt-4o-mini";
}
