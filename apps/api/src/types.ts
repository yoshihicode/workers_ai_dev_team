/**
 * API のリクエスト/レスポンス型（web と共有。CLAUDE.md 9章）
 * web からは `@workers-ai-dev-team/api/types` として参照する。
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

/** POST /api/pm/chat */
export interface PmChatRequest {
	messages: ChatMessage[];
}

/**
 * - hearing: ヒアリング継続
 * - completed: 要件定義書が完成（SE に進む）
 * - rejected: 対象外の依頼のため作成しない（チャットは継続でき、規模を小さくして相談し直せる）
 */
export type PmStatus = "hearing" | "completed" | "rejected";

export interface PmChatResponse {
	status: PmStatus;
	/** ユーザーへの質問・返答（rejected のときは対象外の理由と縮小案） */
	message: string;
	/** completed のときのみ Markdown の要件定義書。それ以外は null */
	requirements: string | null;
}

/** POST /api/agent/work */
export type AgentRole = "SE" | "PG";

/** 相談の質問と、それへの回答 */
export interface QaItem {
	question: string;
	answer: string;
}

export interface AgentWorkRequest {
	role: AgentRole;
	/** 前工程の成果物 */
	input: string;
	/** 着手前の相談で得た回答（任意） */
	qa?: QaItem[];
}

/**
 * 相談（CLAUDE.md 6.5）
 * SE は PM に、PG は SE / PM に、着手前に質問できる（各工程1往復まで）。
 */
export type ConsultTarget = "PM" | "SE";

export interface ConsultQuestion {
	/** 質問の宛先（SE の質問は常に PM 宛て） */
	to: ConsultTarget;
	question: string;
}

/** POST /api/agent/consult: SE / PG が着手前の質問を作る */
export interface AgentConsultRequest {
	role: AgentRole;
	/** 前工程の成果物（SE は要件定義書、PG は設計書） */
	input: string;
	/** これまでの相談で決まった確認事項（PG の場合、SE 工程の相談結果。同じことを質問しないようにする） */
	priorQa?: QaItem[];
}

export interface AgentConsultResponse {
	/** 0〜3件。質問が不要なら空配列 */
	questions: ConsultQuestion[];
}

/** POST /api/agent/answer: PM / SE が質問に回答する */
export interface AgentAnswerRequest {
	/** 回答する役割 */
	role: ConsultTarget;
	/** 質問した役割 */
	from: AgentRole;
	questions: string[];
	requirements: string;
	/** 設計書（SE が回答する場合に必須） */
	design?: string;
	/** PM とのヒアリング記録（PM が回答する場合に使う） */
	messages?: ChatMessage[];
	/** これまでの相談で決まった確認事項（PG の質問に回答するとき、SE 工程の相談結果と矛盾しないようにする） */
	priorQa?: QaItem[];
}

export interface AgentAnswerResponse {
	/** questions と同じ順番 */
	answers: QaItem[];
}

export type ApiErrorCode =
	| "INVALID_REQUEST"
	| "INPUT_TOO_LONG"
	| "DAILY_LIMIT_REACHED"
	| "AI_QUOTA_EXCEEDED"
	| "MODEL_REQUIRES_PAID_PLAN"
	| "AI_INVALID_OUTPUT"
	| "AI_ERROR";

export interface ApiErrorResponse {
	error: {
		code: ApiErrorCode;
		message: string;
	};
}
