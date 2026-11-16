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
		// 1日の Neurons 消費量の記録用（ローカル開発ではローカルの KV を使う）
		USAGE: bindings.kv(),
		// 1日の Neurons 消費量の上限（CLAUDE.md 7.4）。無料枠 10,000 Neurons/日の5割
		DAILY_NEURON_LIMIT: bindings.text("5000"),
	},
});

export default defineConfig({
	worker: apiWorker,
});
