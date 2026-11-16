/**
 * 1日の Neurons 消費量の上限管理（CLAUDE.md 7.4）
 * - AI を呼ぶ前に、その日（UTC）の消費量が上限未満かを確認する
 * - AI を呼んだ後に、応答の usage.neurons を KV に加算する
 * KV は結果整合性のため、同時アクセス時は記録が多少ずれることを許容する（厳密な上限ではない）。
 */

/** 記録用キーの有効期限（2日） */
export const USAGE_TTL_SECONDS = 60 * 60 * 24 * 2;
/** 上限値が不正な場合の既定値（無料枠 10,000 Neurons/日の5割） */
export const DEFAULT_DAILY_NEURON_LIMIT = 5000;
/** 上限値の最大（無料枠 10,000 を超えないよう余裕を持たせる） */
export const MAX_DAILY_NEURON_LIMIT = 9000;

/** KV のうち、この処理で使う操作だけ（テストで差し替えやすくするため） */
export interface UsageStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function usageKey(now: Date): string {
	return `neurons:${now.toISOString().slice(0, 10)}`;
}

export function parseDailyNeuronLimit(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_NEURON_LIMIT;
	return Math.min(n, MAX_DAILY_NEURON_LIMIT);
}

async function readTotal(store: UsageStore, now: Date): Promise<number> {
	const value = Number.parseFloat((await store.get(usageKey(now))) ?? "0");
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** その日の消費量が上限未満なら true（上限を少し超える1回分の呼び出しは許容する） */
export async function isWithinDailyLimit(store: UsageStore, limit: number, now: Date = new Date()): Promise<boolean> {
	return (await readTotal(store, now)) < limit;
}

/** 消費した Neurons をその日の合計に加算する */
export async function addNeurons(store: UsageStore, neurons: number, now: Date = new Date()): Promise<void> {
	if (!Number.isFinite(neurons) || neurons <= 0) return;
	const total = (await readTotal(store, now)) + neurons;
	await store.put(usageKey(now), total.toFixed(2), { expirationTtl: USAGE_TTL_SECONDS });
}

/** Workers AI の usage から Neurons を取り出す */
export function extractNeurons(usage: unknown): number | null {
	if (typeof usage !== "object" || usage === null) return null;
	const neurons = (usage as { neurons?: unknown }).neurons;
	return typeof neurons === "number" && Number.isFinite(neurons) ? neurons : null;
}

/**
 * SSE の末尾から合計の Neurons を取り出す。
 * Workers AI のストリームは最後のイベント（`data: [DONE]` の直前）に合計の usage が入るため、
 * 最後に現れる "neurons" の値を合計とみなす（途中のイベントにも1トークン分の値が入るが、最後が合計）。
 */
export function neuronsFromSseTail(tail: string): number | null {
	const matches = [...tail.matchAll(/"neurons"\s*:\s*([0-9.eE+-]+)/g)];
	const last = matches.at(-1);
	if (!last?.[1]) return null;
	const value = Number.parseFloat(last[1]);
	return Number.isFinite(value) ? value : null;
}

/** 末尾として保持するバイト数（最後の usage イベントが十分に収まる大きさ） */
const TAIL_BYTES = 4096;

/**
 * ストリームを複製し、片方はそのまま返す（クライアントへ中継）。
 * もう片方は末尾の数 KB だけを保持して読み切り、合計の Neurons を onNeurons に渡す。
 * CPU 時間を節約するため、途中のチャンクはデコード・パースしない（CLAUDE.md 3.1）。
 */
export function trackStreamNeurons(
	stream: ReadableStream<Uint8Array>,
	onNeurons: (neurons: number | null) => Promise<void>,
): { stream: ReadableStream<Uint8Array>; done: Promise<void> } {
	const [forClient, forUsage] = stream.tee();
	const done = (async () => {
		const reader = forUsage.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { value, done: finished } = await reader.read();
				if (finished) break;
				chunks.push(value);
				size += value.byteLength;
				// 古いチャンクを捨てて末尾だけを残す
				while (chunks.length > 1 && size - (chunks[0]?.byteLength ?? 0) >= TAIL_BYTES) {
					size -= chunks.shift()?.byteLength ?? 0;
				}
			}
		} catch (error) {
			console.error("usage stream read failed", error);
		}
		const tail = new TextDecoder().decode(concat(chunks));
		await onNeurons(neuronsFromSseTail(tail));
	})();
	return { stream: forClient, done };
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}
