/**
 * SE / PG の着手前の相談（CLAUDE.md 6.5）
 * 1. SE / PG が質問を作る
 * 2. 宛先（PM / SE）ごとに回答をもらう
 * 3. 回答を作業用の入力に付けるため QaItem[] にまとめて返す
 * 相談は各工程1往復まで。
 */
import type { AgentRole, ChatMessage, ConsultQuestion, ConsultTarget, QaItem } from "@workers-ai-dev-team/api/types";
import { ApiError, postAnswer, postConsult } from "./api.ts";
import type { ConsultationRound } from "./consultation.ts";

export const CONSULT_FAILED_NOTE = "質問の作成に失敗したため、相談せずに進めました。";
export const ANSWER_FAILED = "（回答の作成に失敗しました）担当者の判断で決めてください。";

export interface ConsultationDeps {
	postConsult: typeof postConsult;
	postAnswer: typeof postAnswer;
}

export interface ConsultationParams {
	role: AgentRole;
	/** 前工程の成果物（SE は要件定義書、PG は設計書） */
	input: string;
	requirements: string;
	/** PG の相談で SE が回答するときに使う */
	design?: string;
	/** PM が回答するときに使うヒアリング記録 */
	messages: ChatMessage[];
	/** これまでの相談で決まった事項（PG の場合、SE 工程の相談結果） */
	priorQa?: QaItem[];
	signal?: AbortSignal;
	onRound: (round: ConsultationRound) => void;
	deps?: ConsultationDeps;
}

/** AI の出力が解釈できなかっただけのエラーは、相談を省略して先に進める */
function isRecoverable(error: unknown): boolean {
	return error instanceof ApiError && error.code === "AI_INVALID_OUTPUT";
}

export async function runConsultation(params: ConsultationParams): Promise<QaItem[]> {
	const { role, input, requirements, design, messages, signal, onRound } = params;
	const priorQa = params.priorQa ?? [];
	const deps = params.deps ?? { postConsult, postAnswer };

	onRound({ from: role, status: "consulting", entries: [] });

	let questions: ConsultQuestion[];
	try {
		questions = await deps.postConsult(role, input, priorQa, signal);
	} catch (error) {
		if (!isRecoverable(error)) throw error;
		onRound({ from: role, status: "skipped", entries: [], note: CONSULT_FAILED_NOTE });
		return [];
	}

	if (questions.length === 0) {
		onRound({ from: role, status: "done", entries: [] });
		return [];
	}

	onRound({ from: role, status: "answering", entries: questions.map((q) => ({ ...q, answer: null })) });

	// 宛先ごとにまとめて回答をもらう（PG の質問は SE と PM に分かれることがある）
	const targets = [...new Set(questions.map((q) => q.to))];
	const answerMap = new Map<ConsultQuestion, string>();
	await Promise.all(
		targets.map(async (target: ConsultTarget) => {
			const group = questions.filter((q) => q.to === target);
			let answers: QaItem[];
			try {
				answers = await deps.postAnswer(
					{
						role: target,
						from: role,
						questions: group.map((q) => q.question),
						requirements,
						...(target === "SE" && design ? { design } : {}),
						...(target === "PM" ? { messages } : {}),
						...(priorQa.length > 0 ? { priorQa } : {}),
					},
					signal,
				);
			} catch (error) {
				if (!isRecoverable(error)) throw error;
				answers = group.map((q) => ({ question: q.question, answer: ANSWER_FAILED }));
			}
			group.forEach((q, i) => answerMap.set(q, answers[i]?.answer ?? ANSWER_FAILED));
		}),
	);

	const entries = questions.map((q) => ({ ...q, answer: answerMap.get(q) ?? ANSWER_FAILED }));
	onRound({ from: role, status: "done", entries });
	return entries.map((e) => ({ question: e.question, answer: e.answer }));
}
