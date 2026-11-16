import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare({ inspectorPort: 9230 })],
	server: {
		// web（5173）と重ならないポートにする
		port: 5174,
		strictPort: true,
	},
});
