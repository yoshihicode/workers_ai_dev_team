/**
 * レビュー（CLAUDE.md 6.6）
 * PG のソースコードを SE（設計との整合）と PM（要件との整合）が並行してレビューする。
 * 指摘があれば、呼び出し元（App）が PG に1回だけ作り直しを依頼する。
 */
import type {
	ChatMessage,
	QaItem,
	ReviewComment,
	ReviewerRole,
	ReviewVerdict,
} from "@workers-ai-dev-team/api/types";
import { ApiError, postReview } from "./api.ts";

export const REVIEWERS: ReviewerRole[] = ["SE", "PM"];
export const REVIEW_FAILED_NOTE = "レビュー結果の作成に失敗したため、このレビューは省略しました。";

export interface ReviewResult {
	reviewer: ReviewerRole;
	status: "reviewing" | "done" | "skipped";
	verdict?: ReviewVerdict;
	comments: string[];
	note?: string;
}

/** 作り直しの状態（null: まだ / none: 指摘なしで不要 / fixing: 作り直し中 / done: 作り直し済み） */
export type FixStatus = null | "none" | "fixing" | "done";

export interface ReviewDeps {
	postReview: typeof postReview;
}

export interface ReviewParams {
	code: string;
	requirements: string;
	design: string;
	messages: ChatMessage[];
	qa: QaItem[];
	signal?: AbortSignal;
	onResult: (result: ReviewResult) => void;
	deps?: ReviewDeps;
}

/** SE と PM のレビューを並行して行い、作り直しで反映する指摘を返す */
export async function runReviews(params: ReviewParams): Promise<ReviewComment[]> {
	const { code, requirements, design, messages, qa, signal, onResult } = params;
	const deps = params.deps ?? { postReview };

	const results = await Promise.all(
		REVIEWERS.map(async (reviewer): Promise<ReviewResult> => {
			onResult({ reviewer, status: "reviewing", comments: [] });
			let result: ReviewResult;
			try {
				const response = await deps.postReview(
					{
						role: reviewer,
						code,
						requirements,
						...(reviewer === "SE" ? { design } : { messages }),
						...(qa.length > 0 ? { qa } : {}),
					},
					signal,
				);
				result = { reviewer, status: "done", verdict: response.verdict, comments: response.comments };
			} catch (error) {
				// AI の出力が解釈できなかっただけなら、そのレビューを省略して先に進める
				if (!(error instanceof ApiError && error.code === "AI_INVALID_OUTPUT")) throw error;
				result = { reviewer, status: "skipped", comments: [], note: REVIEW_FAILED_NOTE };
			}
			onResult(result);
			return result;
		}),
	);

	return results.flatMap((r) =>
		r.verdict === "changes_requested" ? r.comments.map((comment) => ({ reviewer: r.reviewer, comment })) : [],
	);
}

const REVIEWER_TITLE: Record<ReviewerRole, string> = {
	SE: "SE のレビュー（設計どおりか）",
	PM: "PM のレビュー（要件を満たしているか）",
};

export function reviewMarkdown(results: ReviewResult[], fix: FixStatus): string {
	if (results.length === 0) return "";
	const ordered = REVIEWERS.flatMap((r) => results.filter((x) => x.reviewer === r));
	const sections = ordered.map((r) => {
		const lines = [`## ${REVIEWER_TITLE[r.reviewer]}`, ""];
		if (r.status === "reviewing") lines.push("レビューしています…");
		else if (r.status === "skipped") lines.push(r.note ?? "レビューを省略しました。");
		else if (r.verdict === "approved") lines.push("判定: **承認**（指摘なし）");
		else {
			lines.push("判定: **修正依頼**", "");
			r.comments.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
		}
		return lines.join("\n");
	});

	const fixLine: Record<Exclude<FixStatus, null>, string> = {
		none: "指摘がなかったため、修正はしていません。",
		fixing: "PG が指摘を反映してソースコードを作り直しています…",
		done: "PG が指摘を反映してソースコードを作り直しました。修正前のコードは「修正前のコード」タブで確認できます。",
	};
	const tail = fix ? ["## 修正", "", fixLine[fix]] : [];
	return ["# レビュー記録", "", ...sections.flatMap((s) => [s, ""]), ...tail].join("\n").trimEnd() + "\n";
}
