import { describe, expect, it } from "vitest";
import {
	DEFAULT_DAILY_NEURON_LIMIT,
	MAX_DAILY_NEURON_LIMIT,
	USAGE_TTL_SECONDS,
	addNeurons,
	extractNeurons,
	isWithinDailyLimit,
	neuronsFromSseTail,
	parseDailyNeuronLimit,
	trackStreamNeurons,
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
		expect(usageKey(new Date("2026-11-16T23:00:00Z"))).toBe("neurons:2026-11-16");
	});
});

describe("parseDailyNeuronLimit", () => {
	it("数値文字列を解釈する", () => {
		expect(parseDailyNeuronLimit("3000")).toBe(3000);
	});
	it("不正値は既定値（5,000）", () => {
		expect(parseDailyNeuronLimit(undefined)).toBe(DEFAULT_DAILY_NEURON_LIMIT);
		expect(parseDailyNeuronLimit("abc")).toBe(DEFAULT_DAILY_NEURON_LIMIT);
		expect(parseDailyNeuronLimit("0")).toBe(DEFAULT_DAILY_NEURON_LIMIT);
	});
	it("無料枠を超えないよう上限を丸める", () => {
		expect(parseDailyNeuronLimit("20000")).toBe(MAX_DAILY_NEURON_LIMIT);
	});
});

describe("isWithinDailyLimit / addNeurons", () => {
	const now = new Date("2026-11-16T03:00:00Z");

	it("記録がなければ使える", async () => {
		const { store } = memoryStore();
		expect(await isWithinDailyLimit(store, 5000, now)).toBe(true);
	});

	it("消費量を加算し、有効期限付きで保存する", async () => {
		const { store, data, ttls } = memoryStore();
		await addNeurons(store, 46.5, now);
		await addNeurons(store, 165.81, now);
		expect(Number(data.get("neurons:2026-11-16"))).toBeCloseTo(212.31, 2);
		expect(ttls.get("neurons:2026-11-16")).toBe(USAGE_TTL_SECONDS);
	});

	it("上限に達したら使えない", async () => {
		const { store, data } = memoryStore();
		data.set("neurons:2026-11-16", "5000.00");
		expect(await isWithinDailyLimit(store, 5000, now)).toBe(false);
		data.set("neurons:2026-11-16", "4999.99");
		expect(await isWithinDailyLimit(store, 5000, now)).toBe(true);
	});

	it("日付が変わるとリセットされる", async () => {
		const { store, data } = memoryStore();
		data.set("neurons:2026-11-16", "9999");
		expect(await isWithinDailyLimit(store, 5000, new Date("2026-11-17T00:00:00Z"))).toBe(true);
	});

	it("0 や不正な値は記録しない", async () => {
		const { store, data } = memoryStore();
		await addNeurons(store, 0, now);
		await addNeurons(store, Number.NaN, now);
		expect(data.size).toBe(0);
	});
});

describe("extractNeurons", () => {
	it("usage.neurons を取り出す", () => {
		expect(extractNeurons({ prompt_tokens: 284, neurons: 46.48 })).toBe(46.48);
		expect(extractNeurons({ prompt_tokens: 1 })).toBeNull();
		expect(extractNeurons(undefined)).toBeNull();
	});
});

// 実機の SSE の末尾（Llama の SE ストリーム。途中のイベントにも1トークン分の neurons が入る）
const LLAMA_TAIL = [
	'data: {"choices":[{"delta":{"content":"。"}}],"usage":{"completion_tokens":1,"neurons":0.20480532944202423},"response":"。"}',
	'data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"neurons":0}}',
	'data: {"response":"","usage":{"prompt_tokens":258,"completion_tokens":776,"total_tokens":1034,"neurons":165.80919744074345}}',
	"data: [DONE]",
	"",
].join("\n\n");

describe("neuronsFromSseTail", () => {
	it("最後の usage（合計）の neurons を返す", () => {
		expect(neuronsFromSseTail(LLAMA_TAIL)).toBeCloseTo(165.809, 3);
	});
	it("neurons がなければ null", () => {
		expect(neuronsFromSseTail('data: {"response":"x"}\n\n')).toBeNull();
	});
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c));
			controller.close();
		},
	});
}

describe("trackStreamNeurons", () => {
	it("クライアントには同じ内容を流し、末尾から合計の neurons を取り出す", async () => {
		// 長いストリームの最後に合計が来るケース（途中は 4KB を超える）
		const body = Array.from({ length: 300 }, (_, i) => `data: {"response":"x${i}","usage":{"neurons":0.09}}\n\n`);
		const chunks = [...body, LLAMA_TAIL];
		let recorded: number | null = null;
		const { stream, done } = trackStreamNeurons(streamOf(chunks), async (n) => {
			recorded = n;
		});
		const text = await new Response(stream).text();
		await done;
		expect(text).toBe(chunks.join(""));
		expect(recorded).toBeCloseTo(165.809, 3);
	});
});
