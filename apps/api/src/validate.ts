import type {
	AgentAnswerRequest,
	AgentConsultRequest,
	AgentRole,
	AgentWorkRequest,
	ChatMessage,
	ConsultQuestion,
	PmChatRequest,
	PmChatResponse,
	QaItem,
} from "./types.ts";
import { MAX_QUESTIONS } from "./ai.ts";

/** 作業リクエストに付けられる回答の最大数（PG は SE と PM の両方から最大3件ずつ受け取りうる） */
const MAX_QA_ITEMS = MAX_QUESTIONS * 2;
/** 回答が得られなかった質問に入れる文言 */
export const NO_ANSWER = "（回答なし）担当者の判断で決めてください。";

/** 入力1件あたりの最大文字数（コンテキスト長超過の簡易チェック） */
export const MAX_INPUT_CHARS = 40_000;
/** PM に送る会話履歴の最大件数 */
export const MAX_MESSAGES = 40;
/** PM が完了時に message を返さなかった場合の文言 */
export const PM_COMPLETED_MESSAGE = "要件定義書を作成しました。続けて SE が設計書を作成します。";

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; code: "INVALID_REQUEST" | "INPUT_TOO_LONG"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
	return (
		isRecord(value) &&
		(value.role === "user" || value.role === "assistant") &&
		typeof value.content === "string"
	);
}

export function validatePmChatRequest(body: unknown): ValidationResult<PmChatRequest> {
	if (!isRecord(body) || !Array.isArray(body.messages)) {
		return { ok: false, code: "INVALID_REQUEST", message: "messages は配列で指定してください。" };
	}
	const messages = body.messages;
	if (messages.length === 0 || !messages.every(isChatMessage)) {
		return {
			ok: false,
			code: "INVALID_REQUEST",
			message: "messages の各要素は { role: \"user\" | \"assistant\", content: string } で指定してください。",
		};
	}
	if (messages[messages.length - 1]?.role !== "user") {
		return { ok: false, code: "INVALID_REQUEST", message: "最後のメッセージは user である必要があります。" };
	}
	const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
	if (messages.length > MAX_MESSAGES || totalChars > MAX_INPUT_CHARS) {
		return { ok: false, code: "INPUT_TOO_LONG", message: "会話が長すぎます。最初からやり直してください。" };
	}
	return { ok: true, value: { messages } };
}

function isQaItem(value: unknown): value is QaItem {
	return isRecord(value) && typeof value.question === "string" && typeof value.answer === "string";
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

/** role と input（前工程の成果物）の共通チェック */
function validateRoleAndInput(
	body: unknown,
): ValidationResult<{ role: AgentRole; input: string; body: Record<string, unknown> }> {
	if (!isRecord(body) || (body.role !== "SE" && body.role !== "PG")) {
		return { ok: false, code: "INVALID_REQUEST", message: "role は \"SE\" または \"PG\" で指定してください。" };
	}
	if (!isNonEmptyString(body.input)) {
		return { ok: false, code: "INVALID_REQUEST", message: "input は空でない文字列で指定してください。" };
	}
	if (body.input.length > MAX_INPUT_CHARS) {
		return { ok: false, code: "INPUT_TOO_LONG", message: "前工程の成果物が長すぎます。" };
	}
	return { ok: true, value: { role: body.role, input: body.input, body } };
}

export function validateAgentWorkRequest(body: unknown): ValidationResult<AgentWorkRequest> {
	const base = validateRoleAndInput(body);
	if (!base.ok) return base;
	const { role, input } = base.value;
	const qa = base.value.body.qa;
	if (qa === undefined) return { ok: true, value: { role, input } };
	if (!Array.isArray(qa) || qa.length > MAX_QA_ITEMS || !qa.every(isQaItem)) {
		return { ok: false, code: "INVALID_REQUEST", message: "qa は { question, answer } の配列で指定してください。" };
	}
	const qaChars = qa.reduce((sum, item) => sum + item.question.length + item.answer.length, 0);
	if (input.length + qaChars > MAX_INPUT_CHARS) {
		return { ok: false, code: "INPUT_TOO_LONG", message: "前工程の成果物が長すぎます。" };
	}
	return { ok: true, value: { role, input, qa } };
}

export function validateAgentConsultRequest(body: unknown): ValidationResult<AgentConsultRequest> {
	const base = validateRoleAndInput(body);
	if (!base.ok) return base;
	const { role, input } = base.value;
	const priorQa = base.value.body.priorQa;
	if (priorQa === undefined) return { ok: true, value: { role, input } };
	if (!Array.isArray(priorQa) || priorQa.length > MAX_QA_ITEMS || !priorQa.every(isQaItem)) {
		return { ok: false, code: "INVALID_REQUEST", message: "priorQa は { question, answer } の配列で指定してください。" };
	}
	const qaChars = priorQa.reduce((sum, item) => sum + item.question.length + item.answer.length, 0);
	if (input.length + qaChars > MAX_INPUT_CHARS) {
		return { ok: false, code: "INPUT_TOO_LONG", message: "前工程の成果物が長すぎます。" };
	}
	return { ok: true, value: { role, input, priorQa } };
}

export function validateAgentAnswerRequest(body: unknown): ValidationResult<AgentAnswerRequest> {
	if (!isRecord(body) || (body.role !== "PM" && body.role !== "SE")) {
		return { ok: false, code: "INVALID_REQUEST", message: "role は \"PM\" または \"SE\" で指定してください。" };
	}
	const { role, from, questions, requirements, design, messages, priorQa } = body;
	if (priorQa !== undefined && (!Array.isArray(priorQa) || priorQa.length > MAX_QA_ITEMS || !priorQa.every(isQaItem))) {
		return { ok: false, code: "INVALID_REQUEST", message: "priorQa は { question, answer } の配列で指定してください。" };
	}
	if (from !== "SE" && from !== "PG") {
		return { ok: false, code: "INVALID_REQUEST", message: "from は \"SE\" または \"PG\" で指定してください。" };
	}
	if (role === "SE" && from !== "PG") {
		return { ok: false, code: "INVALID_REQUEST", message: "SE が回答できるのは PG からの質問だけです。" };
	}
	if (
		!Array.isArray(questions) ||
		questions.length === 0 ||
		questions.length > MAX_QUESTIONS ||
		!questions.every(isNonEmptyString)
	) {
		return { ok: false, code: "INVALID_REQUEST", message: `questions は1〜${MAX_QUESTIONS}件の文字列で指定してください。` };
	}
	if (!isNonEmptyString(requirements)) {
		return { ok: false, code: "INVALID_REQUEST", message: "requirements（要件定義書）を指定してください。" };
	}
	if (design !== undefined && typeof design !== "string") {
		return { ok: false, code: "INVALID_REQUEST", message: "design は文字列で指定してください。" };
	}
	if (role === "SE" && !isNonEmptyString(design)) {
		return { ok: false, code: "INVALID_REQUEST", message: "SE が回答する場合は design（設計書）を指定してください。" };
	}
	if (messages !== undefined && (!Array.isArray(messages) || !messages.every(isChatMessage))) {
		return { ok: false, code: "INVALID_REQUEST", message: "messages の形式が正しくありません。" };
	}
	const totalChars =
		requirements.length +
		(design?.length ?? 0) +
		questions.reduce((sum, q) => sum + q.length, 0) +
		(messages ?? []).reduce((sum, m) => sum + m.content.length, 0) +
		(priorQa ?? []).reduce((sum, item) => sum + item.question.length + item.answer.length, 0);
	if (totalChars > MAX_INPUT_CHARS) {
		return { ok: false, code: "INPUT_TOO_LONG", message: "回答に使う資料が長すぎます。" };
	}
	return {
		ok: true,
		value: {
			role,
			from,
			questions,
			requirements,
			...(design !== undefined ? { design } : {}),
			...(messages !== undefined ? { messages } : {}),
			...(priorQa !== undefined ? { priorQa } : {}),
		},
	};
}

/**
 * 回答の先頭に付く番号（「1. 」など）を取り除き、仮定の印を「（仮定）」にそろえる。
 * 実機で「1. ...」「2. (仮定) ...」「(仮定)3. ...」のような形式が返ったため。
 */
export function normalizeAnswer(answer: string): string {
	let text = answer.trim();
	let assumed = false;
	const assumption = /^[（(]\s*仮定\s*[）)]\s*/;
	const numbering = /^\d+\s*[.．、)）]\s*/;
	for (let i = 0; i < 2; i++) {
		if (assumption.test(text)) {
			assumed = true;
			text = text.replace(assumption, "");
		}
		text = text.replace(numbering, "");
	}
	return assumed ? `（仮定）${text}` : text;
}

/**
 * 相談の質問（JSON Mode の response）を検証する。
 * 不正な要素は捨て、最大件数で切る。SE の質問は宛先を PM に固定する。
 * 全体の形式が不正なときだけ null を返す。
 */
export function parseConsultOutput(response: unknown, role: AgentRole): ConsultQuestion[] | null {
	const value = parseJsonResponse(response);
	if (!isRecord(value) || !Array.isArray(value.questions)) return null;
	const questions: ConsultQuestion[] = [];
	for (const item of value.questions) {
		if (!isRecord(item) || !isNonEmptyString(item.question)) continue;
		const to = role === "SE" ? "PM" : item.to === "SE" ? "SE" : "PM";
		questions.push({ to, question: item.question.trim() });
		if (questions.length >= MAX_QUESTIONS) break;
	}
	return questions;
}

/**
 * 回答（JSON Mode の response）を検証し、質問と組にする。
 * 回答が足りない質問には NO_ANSWER を入れる。全体の形式が不正なときだけ null を返す。
 */
export function parseAnswerOutput(response: unknown, questions: string[]): QaItem[] | null {
	const value = parseJsonResponse(response);
	if (!isRecord(value) || !Array.isArray(value.answers)) return null;
	const answers = value.answers;
	return questions.map((question, i) => {
		const answer = answers[i];
		const normalized = isNonEmptyString(answer) ? normalizeAnswer(answer) : "";
		return { question, answer: normalized !== "" ? normalized : NO_ANSWER };
	});
}

/** JSON Mode の response はオブジェクトの場合と JSON 文字列の場合があるため両方に対応する */
function parseJsonResponse(response: unknown): unknown {
	if (typeof response !== "string") return response;
	try {
		return JSON.parse(response);
	} catch {
		return null;
	}
}

/**
 * PM の出力（Workers AI の JSON Mode の response）を検証する。
 * response はオブジェクトで返る場合と JSON 文字列で返る場合があるため両方に対応する。
 */
export function parsePmOutput(response: unknown): PmChatResponse | null {
	const value = parseJsonResponse(response);
	if (!isRecord(value)) return null;
	const { status, message, requirements } = value;
	if (typeof message !== "string") return null;
	if (status === "hearing" || status === "rejected") {
		// 質問・対象外の理由が空ではユーザーに伝わらないため不正とする（再試行の対象）
		if (message.trim() === "") return null;
		return { status, message, requirements: null };
	}
	if (status === "completed" && typeof requirements === "string" && requirements.trim() !== "") {
		// 完了時は message が空で返ることがある（実機で確認）ため既定の文言で補う
		return { status, message: message.trim() === "" ? PM_COMPLETED_MESSAGE : message, requirements };
	}
	return null;
}
