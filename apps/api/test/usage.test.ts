import { describe, expect, it } from "vitest";
import {
	DEFAULT_DAILY_LIMIT,
	MAX_DAILY_LIMIT,
	USAGE_TTL_SECONDS,
	parseDailyLimit,
	tryConsumeDailyCall,
	usageKey,
	type UsageStore,
} from "../src/usage.ts";

function memoryStore() {
	const data = new Map<string, string>();
	const ttls = new Map<string, number | undefined>();
	const store: UsageStore = {
		async get(key) {
			return data.get(key) ?? null;
		},
		async put(key, value, options) {
			data.set(key, value);
			ttls.set(key, options?.expirationTtl);
		},
	};
	return { store, data, ttls };
}

describe("usageKey", () => {
	it("UTC の日付でキーを作る", () => {
		// 日本時間 2026-11-17 08:00 は UTC では 11-16
		expect(usageKey(new Date("2026-11-16T23:00:00Z"))).toBe("usage:2026-11-16");
	});
});

describe("parseDailyLimit", () => {
	it("数値文字列を解釈する", () => {
		expect(parseDailyLimit("10")).toBe(10);
	});
	it("不正値は既定値", () => {
		expect(parseDailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
		expect(parseDailyLimit("abc")).toBe(DEFAULT_DAILY_LIMIT);
		expect(parseDailyLimit("0")).toBe(DEFAULT_DAILY_LIMIT);
	});
	it("KV 書き込み無料枠を超えないよう上限を丸める", () => {
		expect(parseDailyLimit("5000")).toBe(MAX_DAILY_LIMIT);
	});
});

describe("tryConsumeDailyCall", () => {
	const now = new Date("2026-11-16T03:00:00Z");

	it("上限までは回数を増やして true を返す", async () => {
		const { store, data, ttls } = memoryStore();
		expect(await tryConsumeDailyCall(store, 2, now)).toBe(true);
		expect(await tryConsumeDailyCall(store, 2, now)).toBe(true);
		expect(data.get("usage:2026-11-16")).toBe("2");
		expect(ttls.get("usage:2026-11-16")).toBe(USAGE_TTL_SECONDS);
	});

	it("上限に達したら false を返し、書き込まない", async () => {
		const { store, data } = memoryStore();
		data.set("usage:2026-11-16", "2");
		expect(await tryConsumeDailyCall(store, 2, now)).toBe(false);
		expect(data.get("usage:2026-11-16")).toBe("2");
	});

	it("日付が変わるとリセットされる", async () => {
		const { store, data } = memoryStore();
		data.set("usage:2026-11-16", "2");
		expect(await tryConsumeDailyCall(store, 2, new Date("2026-11-17T00:00:00Z"))).toBe(true);
	});
});
