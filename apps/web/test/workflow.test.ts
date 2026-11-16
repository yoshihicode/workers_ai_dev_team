import { describe, expect, it } from "vitest";
import { actorViews, type WorkflowSnapshot } from "../src/lib/workflow.ts";

const base: WorkflowSnapshot = {
	phase: "hearing",
	pmBusy: false,
	failed: false,
	rejected: false,
	step: null,
	answering: [],
	reviewing: [],
	fixed: false,
};
const views = (patch: Partial<WorkflowSnapshot>) => actorViews({ ...base, ...patch });
const states = (patch: Partial<WorkflowSnapshot>) => views(patch).map((a) => a.state);

describe("actorViews", () => {
	it("ヒアリング中は PM のみ稼働中", () => {
		expect(states({})).toEqual(["active", "idle", "idle"]);
	});

	it("PM の返答待ちと回答待ちで詳細テキストが変わる", () => {
		expect(views({}).at(0)?.detail).not.toBe(views({ pmBusy: true }).at(0)?.detail);
	});

	it("設計中は PM 完了・SE 稼働中", () => {
		expect(states({ phase: "designing", step: "work" })).toEqual(["done", "active", "idle"]);
	});

	it("実装中は PG 稼働中", () => {
		expect(states({ phase: "implementing", step: "work" })).toEqual(["done", "done", "active"]);
	});

	it("完了後はすべて完了", () => {
		expect(states({ phase: "done" })).toEqual(["done", "done", "done"]);
	});

	it("失敗した工程の担当がエラー表示になる", () => {
		expect(states({ phase: "hearing", failed: true })).toEqual(["error", "idle", "idle"]);
		expect(states({ phase: "implementing", failed: true })).toEqual(["done", "done", "error"]);
		expect(states({ phase: "reviewing", failed: true })).toEqual(["error", "error", "done"]);
		expect(states({ phase: "fixing", failed: true })).toEqual(["done", "done", "error"]);
	});
});

describe("actorViews（相談）", () => {
	it("SE が質問を整理している間は SE の詳細が相談中になる", () => {
		const [, se] = views({ phase: "designing", step: "consult" });
		expect(se?.detail).toContain("確認事項");
	});

	it("SE の質問に PM が回答している間は PM も稼働中", () => {
		const [pm, se] = views({ phase: "designing", step: "answer", answering: ["PM"] });
		expect(pm?.state).toBe("active");
		expect(pm?.detail).toContain("SE からの質問");
		expect(se?.detail).toContain("回答を待って");
	});

	it("PG の質問に SE と PM が回答している間は両方とも稼働中", () => {
		const [pm, se, pg] = views({ phase: "implementing", step: "answer", answering: ["PM", "SE"] });
		expect([pm?.state, se?.state, pg?.state]).toEqual(["active", "active", "active"]);
		expect(pm?.detail).toContain("PG からの質問");
		expect(se?.detail).toContain("PG からの質問");
	});
});

describe("actorViews（レビュー）", () => {
	it("レビュー中は SE・PM が稼働中で、PG はレビュー待ち", () => {
		const [pm, se, pg] = views({ phase: "reviewing", reviewing: ["SE", "PM"] });
		expect([pm?.state, se?.state, pg?.state]).toEqual(["active", "active", "done"]);
		expect(se?.detail).toContain("設計どおりか");
		expect(pm?.detail).toContain("要件を満たしているか");
		expect(pg?.detail).toContain("レビュー待ち");
	});

	it("片方のレビューが終わったら、そのアクターは完了表示に戻る", () => {
		expect(states({ phase: "reviewing", reviewing: ["PM"] })).toEqual(["active", "done", "done"]);
	});

	it("作り直し中は PG が稼働中、完了後は作り直したことが分かる", () => {
		expect(states({ phase: "fixing" })).toEqual(["done", "done", "active"]);
		expect(views({ phase: "done", fixed: true }).at(2)?.detail).toContain("作り直しました");
	});
});

describe("actorViews（対象外）", () => {
	it("PM が対象外と判断したら PM を「対象外」表示にする", () => {
		expect(states({ rejected: true })).toEqual(["rejected", "idle", "idle"]);
	});

	it("相談し直して PM が考え中の間は通常の稼働中表示に戻る", () => {
		expect(states({ rejected: true, pmBusy: true })).toEqual(["active", "idle", "idle"]);
	});
});
