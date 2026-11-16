/**
 * 1日の AI 呼び出し回数の上限管理（CLAUDE.md 7.4）
 * KV は結果整合性のため、同時アクセス時はカウントが多少ずれることを許容する。
 */

/** カウント用キーの有効期限（2日） */
export const USAGE_TTL_SECONDS = 60 * 60 * 24 * 2;
/** 上限値が不正な場合の既定値 */
export const DEFAULT_DAILY_LIMIT = 43;
/** KV の書き込み無料枠（1,000件/日）を超えないための上限値の最大 */
export const MAX_DAILY_LIMIT = 999;

/** KV のうち、この処理で使う操作だけ（テストで差し替えやすくするため） */
export interface UsageStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function usageKey(now: Date): string {
	return `usage:${now.toISOString().slice(0, 10)}`;
}

export function parseDailyLimit(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_LIMIT;
	return Math.min(n, MAX_DAILY_LIMIT);
}

/**
 * 上限に達していなければ回数を1増やして true を返す。
 * 上限に達していれば何もせず false を返す。
 */
export async function tryConsumeDailyCall(store: UsageStore, limit: number, now: Date = new Date()): Promise<boolean> {
	const key = usageKey(now);
	const current = Number.parseInt((await store.get(key)) ?? "0", 10) || 0;
	if (current >= limit) return false;
	await store.put(key, String(current + 1), { expirationTtl: USAGE_TTL_SECONDS });
	return true;
}
