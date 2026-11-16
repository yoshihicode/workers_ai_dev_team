import { describe, expect, it } from "vitest";
import { consultationMarkdown } from "../src/lib/consultation.ts";

describe("consultationMarkdown", () => {
	it("相談がなければ空文字", () => {
		expect(consultationMarkdown([])).toBe("");
	});

	it("質問と回答を Markdown にする", () => {
		const md = consultationMarkdown([
			{ from: "PG", status: "done", entries: [{ to: "SE", question: "保存キーは？", answer: "expenses" }] },
		]);
		expect(md).toContain("# 相談記録");
		expect(md).toContain("PG から SE・PM への相談");
		expect(md).toContain("### 質問1（PG → SE）");
		expect(md).toContain("**SE の回答**: expenses");
	});

	it("回答待ち・質問なし・省略の状態を表示する", () => {
		const md = consultationMarkdown([
			{ from: "SE", status: "done", entries: [] },
			{ from: "PG", status: "answering", entries: [{ to: "PM", question: "Q", answer: null }] },
		]);
		expect(md).toContain("確認事項はありませんでした。");
		expect(md).toContain("回答を待っています…");
		expect(consultationMarkdown([{ from: "SE", status: "skipped", entries: [], note: "省略" }])).toContain("省略");
	});
});
