import { describe, expect, it } from "vitest";
import { createSseParser } from "../src/lib/sse.ts";

describe("createSseParser", () => {
	it("イベントごとに response を取り出す", () => {
		const parser = createSseParser();
		const texts = parser.push('data: {"response":"こん"}\n\ndata: {"response":"にちは"}\n\n');
		expect(texts).toEqual(["こん", "にちは"]);
		expect(parser.done).toBe(false);
	});

	it("チャンクの途中で分割されても正しく復元する", () => {
		const parser = createSseParser();
		expect(parser.push('data: {"respo')).toEqual([]);
		expect(parser.push('nse":"abc"}\n')).toEqual([]);
		expect(parser.push("\ndata: [DONE]\n\n")).toEqual(["abc"]);
		expect(parser.done).toBe(true);
	});

	it("CRLF 区切りにも対応する", () => {
		const parser = createSseParser();
		expect(parser.push('data: {"response":"x"}\r\n\r\n')).toEqual(["x"]);
	});

	it("OpenAI 互換形式にも対応する", () => {
		const parser = createSseParser();
		expect(parser.push('data: {"choices":[{"delta":{"content":"y"}}]}\n\n')).toEqual(["y"]);
	});

	it("response が数値・配列・真偽値・null で届いても文字列に戻す（Qwen の実機で確認した形式）", () => {
		const parser = createSseParser();
		const texts = parser.push(
			'data: {"response":3,"p":"ab"}\n\ndata: {"response":[]}\n\ndata: {"response":true}\n\ndata: {"response":null}\n\ndata: {"response":{}}\n\n',
		);
		expect(texts).toEqual(["3", "[]", "true", "null", "{}"]);
	});

	it("response と choices の両方がある場合は choices の content を使う（Llama の実機で確認した形式）", () => {
		const parser = createSseParser();
		const texts = parser.push(
			'data: {"choices":[{"index":0,"delta":{"content":"3000"}}],"response":3000}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":1}}\n\n',
		);
		expect(texts).toEqual(["3000"]);
	});

	it("空の response・壊れた JSON・usage だけのイベントは無視する", () => {
		const parser = createSseParser();
		const texts = parser.push('data: {"response":""}\n\ndata: {broken\n\ndata: {"usage":{"total_tokens":10}}\n\n');
		expect(texts).toEqual([]);
	});
});
