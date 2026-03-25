import { NextRequest, NextResponse } from "next/server";
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { logError } from "@/lib/server-log";

type PromptMessage = {
  role: "system" | "user";
  content: string;
};

type AiAction =
  | "rerankCandidates"
  | "suggestShortageFixes"
  | "suggestCompensatoryHolidays"
  | "summarizeLogs"
  | "naturalLanguageEdit"
  | "interpretSupplementNote";

type AiRequestBody = {
  action?: AiAction;
  payload?: unknown;
  stream?: boolean;
};

function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function getApiConfig(): { region: string; modelId: string } {
  const region = process.env.AWS_REGION ?? "";
  const modelId = process.env.BEDROCK_MODEL_ID ?? "";
  if (!region) {
    throw new Error("AWS_REGION が設定されていません。");
  }
  if (!modelId) {
    throw new Error("BEDROCK_MODEL_ID が設定されていません。");
  }
  return { region, modelId };
}

function isInvalidAwsCredentialError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { name?: string; __type?: string };
  return (
    maybeError.name === "UnrecognizedClientException" ||
    maybeError.name === "CredentialsProviderError" ||
    maybeError.__type === "com.amazon.coral.service#UnrecognizedClientException"
  );
}

function extractJsonString(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("AI応答からJSONを抽出できませんでした。");
  }
  return text.slice(start, end + 1);
}

async function callBedrockAsJson(messages: PromptMessage[]): Promise<unknown> {
  const { region, modelId } = getApiConfig();
  const client = new BedrockRuntimeClient({ region });
  const systemTexts = messages.filter((item) => item.role === "system").map((item) => item.content.trim());
  const userText = messages
    .filter((item) => item.role === "user")
    .map((item) => item.content.trim())
    .join("\n\n");

  const command = new ConverseCommand({
    modelId,
    system: systemTexts.map((text) => ({ text })),
    messages: [
      {
        role: "user",
        content: [{ text: userText }]
      }
    ],
    inferenceConfig: {
      temperature: 0.2,
      maxTokens: 1200
    }
  });

  let response: unknown;
  try {
    response = await client.send(command);
  } catch (error) {
    if (isInvalidAwsCredentialError(error)) {
      throw new Error("AWS credentials が無効または期限切れです。");
    }
    throw error;
  }

  const outputText = ((response as { output?: { message?: { content?: Array<{ text?: string }> } } })?.output?.message?.content ??
    [])
    .map((block) => {
      if ("text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("\n")
    .trim();
  if (!outputText) {
    throw new Error("Bedrock の応答が空です。");
  }
  return JSON.parse(extractJsonString(outputText)) as unknown;
}

function extractTextFromStreamEvent(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const maybe = event as {
    contentBlockDelta?: { delta?: { text?: string } };
    delta?: { text?: string };
    outputText?: string;
  };
  if (typeof maybe.contentBlockDelta?.delta?.text === "string") {
    return maybe.contentBlockDelta.delta.text;
  }
  if (typeof maybe.delta?.text === "string") {
    return maybe.delta.text;
  }
  if (typeof maybe.outputText === "string") {
    return maybe.outputText;
  }
  return "";
}

async function callBedrockAsJsonStream(
  messages: PromptMessage[],
  onChunk: (chunk: string) => void
): Promise<unknown> {
  const { region, modelId } = getApiConfig();
  const client = new BedrockRuntimeClient({ region });
  const systemTexts = messages.filter((item) => item.role === "system").map((item) => item.content.trim());
  const userText = messages
    .filter((item) => item.role === "user")
    .map((item) => item.content.trim())
    .join("\n\n");

  const command = new ConverseStreamCommand({
    modelId,
    system: systemTexts.map((text) => ({ text })),
    messages: [
      {
        role: "user",
        content: [{ text: userText }]
      }
    ],
    inferenceConfig: {
      temperature: 0.2,
      maxTokens: 1200
    }
  });

  let response: unknown;
  try {
    response = await client.send(command);
  } catch (error) {
    if (isInvalidAwsCredentialError(error)) {
      throw new Error("AWS credentials が無効または期限切れです。");
    }
    throw error;
  }

  const stream = (response as { stream?: AsyncIterable<unknown> }).stream;
  if (!stream) {
    throw new Error("Bedrock ストリーム応答を取得できませんでした。");
  }

  let fullText = "";
  for await (const event of stream) {
    const text = extractTextFromStreamEvent(event);
    if (!text) {
      continue;
    }
    fullText += text;
    onChunk(text);
  }
  if (!fullText.trim()) {
    throw new Error("Bedrock のストリーミング応答が空です。");
  }
  return JSON.parse(extractJsonString(fullText)) as unknown;
}

function toSseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildMessages(action: AiAction, payload: unknown): PromptMessage[] {
  const systemBase =
    "あなたは保育園シフト調整の補助AIです。必ずJSONのみを返し、説明文やMarkdownは返さないでください。";
  const sharedUser = `action: ${action}\npayload: ${JSON.stringify(payload)}`;

  if (action === "rerankCandidates") {
    return [
      {
        role: "system",
        content: `${systemBase}\n出力形式: {"rankedStaffNames": string[], "reason": string}\nrankedStaffNames には payload.candidates の staffName のみを優先順で返す。`
      },
      { role: "user", content: sharedUser }
    ];
  }

  if (action === "suggestShortageFixes") {
    return [
      {
        role: "system",
        content: `${systemBase}\n出力形式: {"suggestions":[{"date":string,"time":string,"staffName":string,"shiftType":string,"reason":string}]}\n最大3件、実現性の高い提案を返す。staffNameは候補にある実在の個人名のみ（「全員」「常勤スタッフ」など集合名は禁止）。date/timeは具体値のみ。`
      },
      { role: "user", content: sharedUser }
    ];
  }

  if (action === "suggestCompensatoryHolidays") {
    return [
      {
        role: "system",
        content: `${systemBase}\n出力形式: {"suggestions":[{"staffName":string,"saturdayDate":string,"candidateDate":string,"reason":string}]}\n最大5件。必ず具体的なYYYY-MM-DDを返す。「4月中」「平日」など曖昧表現は禁止。staffNameは実在の個人名のみ。`
      },
      { role: "user", content: sharedUser }
    ];
  }

  if (action === "summarizeLogs") {
    return [
      {
        role: "system",
        content: `${systemBase}\n出力形式: {"summary":string,"bullets":string[]}\nsummaryは1-2文、bulletsは最大5件。`
      },
      { role: "user", content: sharedUser }
    ];
  }

  if (action === "interpretSupplementNote") {
    return [
      {
        role: "system",
        content: `${systemBase}\n出力形式: {"guidance":string,"priorityRules":string[]}\nguidanceは短文、priorityRulesは最大5件。補足事項は強制命令ではなく優先度ヒントとして解釈し、過剰に断定しない。`
      },
      { role: "user", content: sharedUser }
    ];
  }

  return [
    {
      role: "system",
      content: `${systemBase}\n出力形式: {"operations":[{"type":"assignShift"|"clearShift"|"setOff","date":string,"staffName":string,"shiftType"?:string,"enabled"?:boolean,"reason"?:string}],"summary":string}\noperationsは最大10件。`
    },
    { role: "user", content: sharedUser }
  ];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as AiRequestBody;
    if (!body.action) {
      return jsonResponse({ error: "action is required" }, 400);
    }
    const messages = buildMessages(body.action, body.payload ?? {});
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const send = (payload: Record<string, unknown>): void => {
            controller.enqueue(encoder.encode(toSseEvent(payload)));
          };
          try {
            send({ type: "start", action: body.action });
            const result = await callBedrockAsJsonStream(messages, (chunk) => {
              send({ type: "chunk", chunk });
            });
            send({ type: "done", action: body.action, result });
          } catch (error) {
            const message = error instanceof Error ? error.message : "AIリクエストに失敗しました。";
            send({ type: "error", message });
          } finally {
            controller.close();
          }
        }
      });
      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        }
      });
    }
    const result = await callBedrockAsJson(messages);
    return jsonResponse({ ok: true, action: body.action, result });
  } catch (error) {
    logError("api/shift-ai.POST", "request failed", error);
    const message = error instanceof Error ? error.message : "AIリクエストに失敗しました。";
    return jsonResponse({ error: message }, 500);
  }
}
