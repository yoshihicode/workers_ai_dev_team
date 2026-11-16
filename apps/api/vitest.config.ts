import { defineConfig } from "vitest/config";

// vite.config.ts（Cloudflare プラグイン）を読み込むとリモートの Workers AI に接続しようとするため、
// テストはプラグインなしの Node 環境で実行する（Neurons を消費しない）。
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
