import type {
	AgentAnswerRequest,
	AgentAnswerResponse,
	AgentConsultRequest,
	AgentConsultResponse,
	AgentRole,
	AgentWorkRequest,
	ApiErrorCode,
	ApiErrorResponse,
	ChatMessage,
	ConsultQuestion,
	PmChatRequest,
	PmChatResponse,
	QaItem,
} from "@workers-ai-dev-team/api/types";
import { createSseParser } from "./sse.ts";

export class ApiError extends Error {
	readonly code: ApiErrorCode | "NETWORK_ERROR";

	constructor(code: ApiErrorCode | "NETWORK_ERROR", message: string) {
		super(message);
		this.name = "ApiError";
		this.code = code;
	}
}

async function toApiError(response: Response): Promise<ApiError> {
	try {
		const body = (await response.json()) as Partial<ApiErrorResponse>;
		if (body.error?.code && body.error.message) return new ApiError(body.error.code, body.error.message);
	} catch {
		// JSON でないエラー（Cloudflare の上限超過ページ等）
	}
	return new ApiError("AI_ERROR", `サーバーでエラーが発生しました（HTTP ${response.status}）。`);
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") throw error;
		throw new ApiError("NETWORK_ERROR", "サーバーに接続できませんでした。");
	}
	if (!response.ok) throw await toApiError(response);
	return response;
}

export async function postPmChat(messages: ChatMessage[], signal?: AbortSignal): Promise<PmChatResponse> {
	const body: PmChatRequest = { messages };
	const response = await post("/api/pm/chat", body, signal);
	return (await response.json()) as PmChatResponse;
}

/** SE / PG が着手前の質問を作る */
export async function postConsult(
	role: AgentRole,
	input: string,
	priorQa: QaItem[],
	signal?: AbortSignal,
): Promise<ConsultQuestion[]> {
	const body: AgentConsultRequest = priorQa.length > 0 ? { role, input, priorQa } : { role, input };
	const response = await post("/api/agent/consult", body, signal);
	return ((await response.json()) as AgentConsultResponse).questions;
}

/** PM / SE が質問に回答する */
export async function postAnswer(req: AgentAnswerRequest, signal?: AbortSignal): Promise<QaItem[]> {
	const response = await post("/api/agent/answer", req, signal);
	return ((await response.json()) as AgentAnswerResponse).answers;
}

/**
 * SE / PG の成果物をストリーミングで受け取る。
 * 受け取った断片ごとに onText を呼び、最後に全文を返す。
 */
export async function streamAgentWork(
	role: AgentRole,
	input: string,
	qa: QaItem[],
	onText: (text: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	const body: AgentWorkRequest = qa.length > 0 ? { role, input, qa } : { role, input };
	const response = await post("/api/agent/work", body, signal);
	if (!response.body) throw new ApiError("AI_ERROR", "ストリームを受信できませんでした。");

	const parser = createSseParser();
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let full = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		for (const text of parser.push(value)) {
			full += text;
			onText(text);
		}
		if (parser.done) break;
	}
	if (full.trim() === "") throw new ApiError("AI_INVALID_OUTPUT", "AI から成果物を受け取れませんでした。");
	return full;
}
