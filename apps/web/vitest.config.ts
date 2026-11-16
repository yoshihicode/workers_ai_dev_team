import { defineConfig } from "vitest/config";

// Cloudflare プラグインを読み込まず、Node 環境で単体テストを実行する
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
