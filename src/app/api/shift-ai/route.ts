import { NextRequest, NextResponse } from "next/server";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
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
    const result = await callBedrockAsJson(messages);
    return jsonResponse({ ok: true, action: body.action, result });
  } catch (error) {
    logError("api/shift-ai.POST", "request failed", error);
    const message = error instanceof Error ? error.message : "AIリクエストに失敗しました。";
    return jsonResponse({ error: message }, 500);
  }
}
