import { describe, expect, it, vi } from "vitest";
import type { AgentReviewRequest, AgentReviewResponse } from "@workers-ai-dev-team/api/types";
import { ApiError } from "../src/lib/api.ts";
import { REVIEW_FAILED_NOTE, reviewMarkdown, runReviews, type ReviewDeps, type ReviewResult } from "../src/lib/review.ts";

function setup(respond: (req: AgentReviewRequest) => AgentReviewResponse | Error) {
	const results: ReviewResult[] = [];
	const calls: AgentReviewRequest[] = [];
	const deps: ReviewDeps = {
		postReview: vi.fn(async (req: AgentReviewRequest) => {
			calls.push(req);
			const r = respond(req);
			if (r instanceof Error) throw r;
			return r;
		}),
	};
	const params = {
		code: "CODE",
		requirements: "# 要件",
		design: "# 設計",
		messages: [{ role: "user" as const, content: "家計簿" }],
		qa: [{ question: "Q", answer: "A" }],
		onResult: (r: ReviewResult) => results.push(r),
		deps,
	};
	return { results, calls, params };
}

describe("runReviews", () => {
	it("SE には設計書、PM にはヒアリング記録を渡して並行でレビューする", async () => {
		const { calls, params } = setup(() => ({ verdict: "approved", comments: [] }));
		await runReviews(params);
		const se = calls.find((c) => c.role === "SE");
		const pm = calls.find((c) => c.role === "PM");
		expect(se).toMatchObject({ code: "CODE", design: "# 設計", qa: [{ question: "Q", answer: "A" }] });
		expect(se?.messages).toBeUndefined();
		expect(pm?.messages).toHaveLength(1);
		expect(pm?.design).toBeUndefined();
	});

	it("両方承認なら指摘なし", async () => {
		const { params } = setup(() => ({ verdict: "approved", comments: [] }));
		expect(await runReviews(params)).toEqual([]);
	});

	it("修正依頼の指摘をレビュアー付きで返す", async () => {
		const { params } = setup((req) =>
			req.role === "SE" ? { verdict: "changes_requested", comments: ["削除機能がない"] } : { verdict: "approved", comments: [] },
		);
		expect(await runReviews(params)).toEqual([{ reviewer: "SE", comment: "削除機能がない" }]);
	});

	it("AI の出力が解釈できなかったレビューは省略して進める", async () => {
		const { results, params } = setup((req) =>
			req.role === "PM" ? new ApiError("AI_INVALID_OUTPUT", "x") : { verdict: "changes_requested", comments: ["A"] },
		);
		expect(await runReviews(params)).toEqual([{ reviewer: "SE", comment: "A" }]);
		expect(results.find((r) => r.reviewer === "PM" && r.status === "skipped")?.note).toBe(REVIEW_FAILED_NOTE);
	});

	it("利用上限などのエラーは呼び出し元に伝える", async () => {
		const { params } = setup(() => new ApiError("DAILY_LIMIT_REACHED", "上限"));
		await expect(runReviews(params)).rejects.toMatchObject({ code: "DAILY_LIMIT_REACHED" });
	});
});

describe("reviewMarkdown", () => {
	it("レビューがなければ空文字", () => {
		expect(reviewMarkdown([], null)).toBe("");
	});

	it("判定・指摘・修正の状況を表示する（SE → PM の順）", () => {
		const md = reviewMarkdown(
			[
				{ reviewer: "PM", status: "done", verdict: "approved", comments: [] },
				{ reviewer: "SE", status: "done", verdict: "changes_requested", comments: ["削除機能がない"] },
			],
			"done",
		);
		expect(md.indexOf("SE のレビュー")).toBeLessThan(md.indexOf("PM のレビュー"));
		expect(md).toContain("判定: **修正依頼**");
		expect(md).toContain("1. 削除機能がない");
		expect(md).toContain("判定: **承認**");
		expect(md).toContain("修正前のコード");
	});

	it("指摘なしのときは修正していないことを表示する", () => {
		const md = reviewMarkdown([{ reviewer: "SE", status: "done", verdict: "approved", comments: [] }], "none");
		expect(md).toContain("修正はしていません");
	});
});
