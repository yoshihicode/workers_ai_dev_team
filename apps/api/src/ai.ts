/**
 * モデル定義・max_tokens・システムプロンプト・Workers AI 呼び出し・エラー判定
 */
import type { AgentAnswerRequest, AgentRole, ApiErrorCode, ChatMessage, QaItem } from "./types.ts";

export const MODELS = {
	PM: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	SE: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	PG: "@cf/qwen/qwen2.5-coder-32b-instruct",
	/**
	 * 相談（質問作成・回答）用。JSON Mode が必要なため Llama を使う。
	 * Qwen2.5-Coder は JSON Mode 非対応のため、PG の質問作成も Llama に PG 役をさせる。
	 */
	CONSULT: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
} as const;

/** 1工程あたりの質問の最大数 */
export const MAX_QUESTIONS = 3;

/**
 * 生成トークン数の上限（Workers AI の既定値は 256 のため必ず指定する）。
 * コンテキスト長: Llama 3.3 70B = 24,000 / Qwen2.5-Coder 32B = 32,768 トークン。
 * Neurons 消費（無料枠 10,000/日）を考慮して控えめにしている。
 */
export const MAX_TOKENS = {
	PM: 2048,
	SE: 4096,
	PG: 4096,
	CONSULT: 512,
	ANSWER: 1024,
} as const;

/**
 * 作成対象の範囲（CLAUDE.md 1章）。PG の出力上限（max_tokens）で完成できる小規模なものに限る。
 * PM はこの範囲に収まらない依頼をヒアリング段階で断る。
 */
export const SCOPE_RULES = [
	"【作成できるもの】次のいずれかに当てはまる、小規模なものだけです。",
	"1. ブラウザだけで動く小さなWebアプリ（データはlocalStorageに保存。サーバー・データベースは使わない）",
	"2. 単機能のスクリプトやCLIツール",
	"3. 数画面程度（目安3画面まで）のフロントエンド、または小さなAPI（目安としてエンドポイント5つまで。データはメモリまたはファイルに保存）",
	"ソースコード全体が数百行程度に収まる規模が目安です。",
	"【作成できないもの（対象外）】",
	"- ログイン・ユーザー管理・権限管理などの認証機能",
	"- 外部データベース（MySQL、PostgreSQL、Firebase等）やクラウドサービスとの連携",
	"- 決済、メール送信、外部APIとの連携が必須のもの",
	"- チャットや共同編集などのリアルタイム通信",
	"- 複数のサービス・サーバーで構成されるシステム、管理画面を含む業務システム、ECサイト、SNS",
	"- スマートフォンやデスクトップのネイティブアプリ、ゲームエンジンを使うゲーム",
	"- 上記以外でも、4画面以上や数百行を大きく超える規模になるもの",
].join("\n");

export const SYSTEM_PROMPTS = {
	PM: [
		"あなたは優秀なPMです。ユーザーと対話し要件を定義します。",
		SCOPE_RULES,
		"【応答のルール】",
		"- 依頼が対象外の場合、または対話の途中で対象外の機能が追加された場合は、status: 'rejected'とし、requirementsはnullにしてください。messageには、対象外である理由と、作成できるものの範囲に収まる縮小案を書いてください。",
		"- 規模が判断できない場合や情報が足りない場合はstatus: 'hearing'とし、質問をmessageに入れ、requirementsはnullにしてください。",
		"- 対象内であり十分に情報が集まったらstatus: 'completed'とし、requirementsにMarkdown形式の要件定義書を出力してください。要件定義書には上記の対象外の機能を含めないでください。",
		"- 質問は一度に3つ程度までにしてください。回答は日本語で行ってください。",
	].join("\n"),
	SE: "あなたは経験豊富なSEです。入力された要件定義書をもとに、基本設計書および詳細設計書をMarkdown形式で作成してください。対象は小規模なアプリのため、ファイル数・画面数は必要最小限の構成にしてください。回答は日本語で行ってください。",
	PG: "あなたは熟練のPGです。入力された詳細設計書に厳密に従い、実際に動作するクリーンなソースコードと実行手順を出力してください。対象は小規模なアプリのため、必要最小限のファイル構成で、すべてのファイルを省略せずに出力してください。説明は日本語で行ってください。",
} as const;

/** PM の出力形式（JSON Mode の json_schema） */
export const PM_JSON_SCHEMA = {
	type: "object",
	properties: {
		status: { type: "string", enum: ["hearing", "completed", "rejected"] },
		message: { type: "string" },
		requirements: { type: ["string", "null"] },
	},
	required: ["status", "message", "requirements"],
} as const;

const COMMON_QUESTION_RULES = [
	`質問は最大${MAX_QUESTIONS}つまでです。成果物に大きく影響し、渡された資料だけでは判断できない点だけを質問してください。`,
	"細かな点や、一般的な慣習で決められる点は質問せず、自分で判断してください。質問が不要な場合は空の配列を返してください。",
	"1つの質問には1つの論点だけを、日本語で簡潔に書いてください。",
].join("\n");

export const CONSULT_PROMPTS = {
	SE: [
		"あなたは経験豊富なSEです。これから要件定義書をもとに基本設計書・詳細設計書を作成します。",
		"設計を始める前に、PMへの質問を作成してください。質問の宛先（to）はすべて'PM'としてください。",
		COMMON_QUESTION_RULES,
	].join("\n"),
	PG: [
		"あなたは熟練のPGです。これから設計書をもとにソースコードを実装します。",
		"実装を始める前に、質問を作成してください。",
		"設計（ファイル構成・データ構造・処理方式・画面の作り）に関する質問は宛先（to）を'SE'、要件（機能・仕様・利用者の意図）に関する質問は宛先を'PM'としてください。",
		COMMON_QUESTION_RULES,
	].join("\n"),
} as const;

const COMMON_ANSWER_RULES = [
	"質問と同じ順番で、各質問への回答を3文以内で簡潔に日本語で書いてください。",
	"回答の先頭に番号は付けないでください。",
	"資料に答えがない場合は、利用者の意図に沿った妥当な方針を決め、回答の先頭に「（仮定）」と付けてください。",
	"「これまでの相談で決まった事項」がある場合は、それと矛盾しない回答をしてください。",
	"このプロジェクトは小規模なアプリが対象です。ログイン機能、外部データベース、決済などの対象外の機能を追加する回答はしないでください。",
].join("\n");

export const ANSWER_PROMPTS = {
	PM: [
		"あなたはこのプロジェクトのPMです。ユーザーとのヒアリング記録と要件定義書をもとに、開発メンバーからの質問に答えてください。",
		COMMON_ANSWER_RULES,
	].join("\n"),
	SE: [
		"あなたはこのプロジェクトのSEです。要件定義書と、あなたが作成した設計書をもとに、PGからの質問に答えてください。",
		COMMON_ANSWER_RULES,
	].join("\n"),
} as const;

export const CONSULT_JSON_SCHEMA = {
	type: "object",
	properties: {
		questions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					to: { type: "string", enum: ["PM", "SE"] },
					question: { type: "string" },
				},
				required: ["to", "question"],
			},
		},
	},
	required: ["questions"],
} as const;

export const ANSWER_JSON_SCHEMA = {
	type: "object",
	properties: {
		answers: { type: "array", items: { type: "string" } },
	},
	required: ["answers"],
} as const;

const ROLE_LABEL = { PM: "PM", SE: "SE", PG: "PG", user: "ユーザー", assistant: "PM" } as const;

/** 回答用の資料（ユーザーメッセージ）を組み立てる */
export function buildAnswerInput(req: AgentAnswerRequest): string {
	const parts: string[] = [];
	if (req.role === "PM" && req.messages?.length) {
		parts.push(
			"# ヒアリング記録",
			req.messages.map((m) => `${ROLE_LABEL[m.role]}: ${m.content}`).join("\n\n"),
		);
	}
	parts.push("# 要件定義書", req.requirements);
	if (req.design) parts.push("# 設計書", req.design);
	if (req.priorQa?.length) {
		parts.push("# これまでの相談で決まった事項（これと矛盾しない回答をしてください）", formatQaList(req.priorQa));
	}
	parts.push(
		`# ${ROLE_LABEL[req.from]}からの質問`,
		req.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
	);
	return parts.join("\n\n");
}

function formatQaList(qa: QaItem[]): string {
	return qa.map((item) => `- ${item.question}\n  → ${item.answer}`).join("\n");
}

/** 質問作成用の入力（PG の場合は SE 工程の相談結果も付ける） */
export function buildConsultInput(input: string, priorQa: QaItem[] | undefined): string {
	if (!priorQa?.length) return input;
	return `${input}\n\n---\n\n## これまでの相談で決まった事項（これについては質問しないでください）\n${formatQaList(priorQa)}`;
}

/** 作業用の入力に、相談で得た回答を付け加える */
export function buildWorkInput(input: string, qa: QaItem[] | undefined): string {
	if (!qa?.length) return input;
	const answers = qa.map((item, i) => `### 確認${i + 1}. ${item.question}\n回答: ${item.answer}`).join("\n\n");
	return `${input}\n\n---\n\n## 着手前の確認事項と回答\n以下の回答も踏まえて作成してください。\n\n${answers}`;
}

async function runJson(ai: Ai, system: string, user: string, maxTokens: number, schema: object): Promise<unknown> {
	const result = await ai.run(MODELS.CONSULT, {
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		max_tokens: maxTokens,
		response_format: { type: "json_schema", json_schema: schema },
	});
	const { response, usage } = result as { response?: unknown; usage?: unknown };
	if (usage) console.log("CONSULT usage", JSON.stringify(usage));
	return response;
}

export function runConsult(ai: Ai, role: AgentRole, input: string, priorQa?: QaItem[]): Promise<unknown> {
	return runJson(ai, CONSULT_PROMPTS[role], buildConsultInput(input, priorQa), MAX_TOKENS.CONSULT, CONSULT_JSON_SCHEMA);
}

export function runAnswer(ai: Ai, req: AgentAnswerRequest): Promise<unknown> {
	return runJson(ai, ANSWER_PROMPTS[req.role], buildAnswerInput(req), MAX_TOKENS.ANSWER, ANSWER_JSON_SCHEMA);
}

export async function runPm(ai: Ai, messages: ChatMessage[]): Promise<unknown> {
	const result = await ai.run(MODELS.PM, {
		messages: [{ role: "system", content: SYSTEM_PROMPTS.PM }, ...messages],
		max_tokens: MAX_TOKENS.PM,
		response_format: { type: "json_schema", json_schema: PM_JSON_SCHEMA },
	});
	const { response, usage } = result as { response?: unknown; usage?: unknown };
	// Neurons 消費の把握用（SE / PG は SSE の最終イベントに usage が含まれる）
	if (usage) console.log("PM usage", JSON.stringify(usage));
	return response;
}

/** SE / PG を stream: true で呼び出し、Workers AI の SSE ストリームをそのまま返す */
export async function runAgentStream(
	ai: Ai,
	role: AgentRole,
	input: string,
	qa?: QaItem[],
): Promise<ReadableStream> {
	const result = await ai.run(MODELS[role], {
		messages: [
			{ role: "system", content: SYSTEM_PROMPTS[role] },
			{ role: "user", content: buildWorkInput(input, qa) },
		],
		max_tokens: MAX_TOKENS[role],
		stream: true,
	});
	return result as ReadableStream;
}

/** JSON の解釈に失敗したときを含めた試行回数（CLAUDE.md 7.1: 1回だけ再試行） */
const JSON_MAX_ATTEMPTS = 2;

/**
 * JSON Mode の呼び出しを行い、parse で検証する。
 * 解釈できない出力のときは1回だけ再試行し、無料枠超過などの再試行しても解決しないエラーはすぐ返す。
 */
export async function callJsonWithRetry<T>(
	label: string,
	call: () => Promise<unknown>,
	parse: (response: unknown) => T | null,
): Promise<{ ok: true; value: T } | { ok: false; error: ClassifiedAiError }> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < JSON_MAX_ATTEMPTS; attempt++) {
		try {
			const parsed = parse(await call());
			if (parsed !== null) return { ok: true, value: parsed };
			lastError = new Error("JSON Mode couldn't be met");
		} catch (error) {
			const classified = classifyAiError(error);
			if (classified.code !== "AI_INVALID_OUTPUT") {
				console.error(`${label} call failed`, error);
				return { ok: false, error: classified };
			}
			lastError = error;
		}
	}
	console.error(`${label} output invalid`, lastError);
	return { ok: false, error: classifyAiError(lastError) };
}

export interface ClassifiedAiError {
	status: 403 | 429 | 502;
	code: ApiErrorCode;
	message: string;
}

/**
 * Workers AI のエラーを分類する。
 * - 3036: 無料枠（10,000 Neurons/日）の使い切り
 * - 5035: 有料プラン専用モデル
 */
export function classifyAiError(error: unknown): ClassifiedAiError {
	const text = error instanceof Error ? error.message : String(error);
	if (/\b3036\b|daily free allocation/i.test(text)) {
		return {
			status: 429,
			code: "AI_QUOTA_EXCEEDED",
			message: "本日の無料枠（Workers AI）の上限に達しました。UTC 0時（日本時間 9時）以降に再度お試しください。",
		};
	}
	if (/\b5035\b|requires a Workers Paid plan/i.test(text)) {
		return {
			status: 403,
			code: "MODEL_REQUIRES_PAID_PLAN",
			message: "使用中のモデルは無料プランでは利用できません。管理者に連絡してください。",
		};
	}
	if (/JSON Mode couldn't be met/i.test(text)) {
		return { status: 502, code: "AI_INVALID_OUTPUT", message: "AI の応答を解釈できませんでした。もう一度送信してください。" };
	}
	return { status: 502, code: "AI_ERROR", message: "AI の呼び出しに失敗しました。時間をおいて再度お試しください。" };
}
