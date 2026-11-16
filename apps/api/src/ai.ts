/**
 * モデル定義・max_tokens・システムプロンプト・Workers AI 呼び出し・エラー判定
 */
import type {
	AgentAnswerRequest,
	AgentReviewRequest,
	AgentRole,
	ApiErrorCode,
	ChatMessage,
	QaItem,
	ReviewFix,
} from "./types.ts";
import { extractNeurons } from "./usage.ts";

export const MODELS = {
	PM: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	SE: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	PG: "@cf/qwen/qwen2.5-coder-32b-instruct",
	/**
	 * 相談（質問作成・回答）とレビュー用。JSON Mode が必要なため Llama を使う。
	 * Qwen2.5-Coder は JSON Mode 非対応のため、PG の質問作成も Llama に PG 役をさせる。
	 */
	CONSULT: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
} as const;

/** 1工程あたりの質問の最大数 */
export const MAX_QUESTIONS = 3;
/** 1人のレビュアーが出す指摘の最大数 */
export const MAX_REVIEW_COMMENTS = 5;

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
	REVIEW: 1024,
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

const COMMON_REVIEW_RULES = [
	`指摘は重要なものだけを最大${MAX_REVIEW_COMMENTS}件まで、修正すべき内容が分かるように日本語で1件ずつ簡潔に書いてください。`,
	"各指摘は「【場所】ファイル名や機能 【問題】資料で求められている内容と、実際のコードの内容 【修正】何をどう直すか」の形で具体的に書いてください。",
	"実際のコードを読んで問題があると確信できる点だけを指摘してください。資料とコードが同じ内容なら指摘しないでください。確信が持てない点は指摘しないでください。",
	"「〜を確認してください」「〜が正しく動作することを確認してください」のような、修正内容が決まらない確認依頼は書かないでください。問題があると判断した場合だけ、その問題を指摘してください。",
	"同じ内容の指摘を重複して書かないでください。",
	"コードの書き方の好み、命名、コメントの有無、コードの整理やリファクタリング、ログ出力の有無、細かなスタイルは指摘しないでください。",
	"対象は小規模なアプリです。ログイン機能、外部データベース、決済などの対象外の機能を追加する指摘はしないでください。",
	"修正が必要な指摘がある場合はverdictを'changes_requested'、問題がなければverdictを'approved'としcommentsを空の配列にしてください。",
	"指摘の先頭に番号は付けないでください。",
].join("\n");

export const REVIEW_PROMPTS = {
	SE: [
		"あなたはこのプロジェクトのSEです。あなたが作成した設計書と照らして、PGが作成したソースコードをレビューしてください。",
		"確認する観点: 設計書どおりに実装されているか（ファイル構成・データ構造・処理）、設計書にある機能の抜け漏れ、明らかな不具合（構文の誤り、未定義の変数や関数、動かない処理、ファイルの欠落）。",
		COMMON_REVIEW_RULES,
	].join("\n"),
	PM: [
		"あなたはこのプロジェクトのPMです。ユーザーとのヒアリング記録と要件定義書に照らして、PGが作成したソースコードと実行手順をレビューしてください。",
		"確認する観点: 要件定義書の機能がすべて実装されているか、ユーザーの意図や仕様と食い違う動きがないか、実行手順でユーザーが動かせるか、要件にない対象外の機能が追加されていないか。",
		"あなたはPMなので、利用者から見た機能・仕様の観点だけで指摘してください。コードの内部の作り（関数の分け方、重複、エラー処理の書き方など）は指摘しないでください。",
		COMMON_REVIEW_RULES,
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

export const REVIEW_JSON_SCHEMA = {
	type: "object",
	properties: {
		verdict: { type: "string", enum: ["approved", "changes_requested"] },
		comments: { type: "array", items: { type: "string" } },
	},
	required: ["verdict", "comments"],
} as const;

const ROLE_LABEL = { PM: "PM", SE: "SE", PG: "PG", user: "ユーザー", assistant: "PM" } as const;

function formatHearing(messages: ChatMessage[]): string {
	return messages.map((m) => `${ROLE_LABEL[m.role]}: ${m.content}`).join("\n\n");
}

function formatQaList(qa: QaItem[]): string {
	return qa.map((item) => `- ${item.question}\n  → ${item.answer}`).join("\n");
}

/** 回答用の資料（ユーザーメッセージ）を組み立てる */
export function buildAnswerInput(req: AgentAnswerRequest): string {
	const parts: string[] = [];
	if (req.role === "PM" && req.messages?.length) parts.push("# ヒアリング記録", formatHearing(req.messages));
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

/** レビュー用の資料を組み立てる（SE は設計書、PM はヒアリング記録を中心に見る） */
export function buildReviewInput(req: AgentReviewRequest): string {
	const parts: string[] = [];
	if (req.role === "PM" && req.messages?.length) parts.push("# ヒアリング記録", formatHearing(req.messages));
	parts.push("# 要件定義書", req.requirements);
	if (req.role === "SE" && req.design) parts.push("# 設計書", req.design);
	if (req.qa?.length) parts.push("# 着手前の相談で決まった事項", formatQaList(req.qa));
	parts.push("# レビュー対象のソースコードと実行手順", req.code);
	return parts.join("\n\n");
}

/** 質問作成用の入力（PG の場合は SE 工程の相談結果も付ける） */
export function buildConsultInput(input: string, priorQa: QaItem[] | undefined): string {
	if (!priorQa?.length) return input;
	return `${input}\n\n---\n\n## これまでの相談で決まった事項（これについては質問しないでください）\n${formatQaList(priorQa)}`;
}

/**
 * 作業用の入力に、相談で得た回答を付け加える。
 * review があれば（PG の修正）、修正前のソースコードとレビューの指摘も付ける。
 */
export function buildWorkInput(input: string, qa: QaItem[] | undefined, review?: ReviewFix): string {
	let text = input;
	if (qa?.length) {
		const answers = qa.map((item, i) => `### 確認${i + 1}. ${item.question}\n回答: ${item.answer}`).join("\n\n");
		text += `\n\n---\n\n## 着手前の確認事項と回答\n以下の回答も踏まえて作成してください。\n\n${answers}`;
	}
	if (review) {
		const comments = review.comments.map((c, i) => `${i + 1}. [${c.reviewer}] ${c.comment}`).join("\n");
		text +=
			"\n\n---\n\n## 修正前のソースコード\n" +
			review.previousCode +
			"\n\n---\n\n## レビューでの指摘\n" +
			comments +
			"\n\n上記の指摘をすべて反映した、修正後のソースコードと実行手順を出力してください。" +
			"修正していないファイルも含めて、すべてのファイルを省略せずに出力してください。";
	}
	return text;
}

/** JSON Mode の呼び出し結果（Neurons の記録用に消費量も返す） */
export interface AiJsonResult {
	response: unknown;
	neurons: number;
}

async function runJson(
	ai: Ai,
	label: string,
	model: (typeof MODELS)["PM" | "CONSULT"],
	messages: { role: "system" | "user" | "assistant"; content: string }[],
	maxTokens: number,
	schema: object,
): Promise<AiJsonResult> {
	const result = await ai.run(model, {
		messages,
		max_tokens: maxTokens,
		response_format: { type: "json_schema", json_schema: schema },
	});
	const { response, usage } = result as { response?: unknown; usage?: unknown };
	if (usage) console.log(`${label} usage`, JSON.stringify(usage));
	return { response, neurons: extractNeurons(usage) ?? 0 };
}

function system(content: string) {
	return { role: "system" as const, content };
}

function user(content: string) {
	return { role: "user" as const, content };
}

export function runPm(ai: Ai, messages: ChatMessage[]): Promise<AiJsonResult> {
	return runJson(ai, "PM", MODELS.PM, [system(SYSTEM_PROMPTS.PM), ...messages], MAX_TOKENS.PM, PM_JSON_SCHEMA);
}

export function runConsult(ai: Ai, role: AgentRole, input: string, priorQa?: QaItem[]): Promise<AiJsonResult> {
	const messages = [system(CONSULT_PROMPTS[role]), user(buildConsultInput(input, priorQa))];
	return runJson(ai, "CONSULT", MODELS.CONSULT, messages, MAX_TOKENS.CONSULT, CONSULT_JSON_SCHEMA);
}

export function runAnswer(ai: Ai, req: AgentAnswerRequest): Promise<AiJsonResult> {
	const messages = [system(ANSWER_PROMPTS[req.role]), user(buildAnswerInput(req))];
	return runJson(ai, "ANSWER", MODELS.CONSULT, messages, MAX_TOKENS.ANSWER, ANSWER_JSON_SCHEMA);
}

export function runReview(ai: Ai, req: AgentReviewRequest): Promise<AiJsonResult> {
	const messages = [system(REVIEW_PROMPTS[req.role]), user(buildReviewInput(req))];
	return runJson(ai, "REVIEW", MODELS.CONSULT, messages, MAX_TOKENS.REVIEW, REVIEW_JSON_SCHEMA);
}

/** SE / PG を stream: true で呼び出し、Workers AI の SSE ストリームをそのまま返す */
export async function runAgentStream(
	ai: Ai,
	role: AgentRole,
	input: string,
	qa?: QaItem[],
	review?: ReviewFix,
): Promise<ReadableStream<Uint8Array>> {
	const result = await ai.run(MODELS[role], {
		messages: [system(SYSTEM_PROMPTS[role]), user(buildWorkInput(input, qa, review))],
		max_tokens: MAX_TOKENS[role],
		stream: true,
	});
	return result as ReadableStream<Uint8Array>;
}

/** JSON の解釈に失敗したときを含めた試行回数（CLAUDE.md 7.1: 1回だけ再試行） */
const JSON_MAX_ATTEMPTS = 2;

export type JsonCallResult<T> =
	| { ok: true; value: T; neurons: number }
	| { ok: false; error: ClassifiedAiError; neurons: number };

/**
 * JSON Mode の呼び出しを行い、parse で検証する。
 * 解釈できない出力のときは1回だけ再試行し、無料枠超過などの再試行しても解決しないエラーはすぐ返す。
 * neurons は再試行分も含めた合計。
 */
export async function callJsonWithRetry<T>(
	label: string,
	call: () => Promise<AiJsonResult>,
	parse: (response: unknown) => T | null,
): Promise<JsonCallResult<T>> {
	let lastError: unknown = null;
	let neurons = 0;
	for (let attempt = 0; attempt < JSON_MAX_ATTEMPTS; attempt++) {
		try {
			const result = await call();
			neurons += result.neurons;
			const parsed = parse(result.response);
			if (parsed !== null) return { ok: true, value: parsed, neurons };
			lastError = new Error("JSON Mode couldn't be met");
		} catch (error) {
			const classified = classifyAiError(error);
			if (classified.code !== "AI_INVALID_OUTPUT") {
				console.error(`${label} call failed`, error);
				return { ok: false, error: classified, neurons };
			}
			lastError = error;
		}
	}
	console.error(`${label} output invalid`, lastError);
	return { ok: false, error: classifyAiError(lastError), neurons };
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
