import { bindings, defineConfig, defineWorker } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

/** web Worker から Service Binding で参照するため export する */
export const apiWorker = defineWorker({
	name: "workers-ai-dev-team-api",
	compatibilityDate: "2026-11-13",
	// workers.dev の公開 URL を作らない（web からの Service Binding 専用。Wrangler の workers_dev: false と同じ）
	workersDev: false,
	entrypoint,
	env: {
		// Workers AI はローカルで再現できないため、開発中もリモート（Cloudflare 上）で実行する
		AI: bindings.ai({ dev: { remote: true } }),
		// 1日の AI 呼び出し回数カウント用（ローカル開発ではローカルの KV を使う）
		USAGE: bindings.kv(),
		// 1日の AI 呼び出し回数の上限（CLAUDE.md 7.4）。無料枠 10,000 Neurons の約5割（平均 115 Neurons/回 × 43 ≒ 4,950）
		DAILY_AI_CALL_LIMIT: bindings.text("43"),
	},
});

export default defineConfig({
	worker: apiWorker,
});
