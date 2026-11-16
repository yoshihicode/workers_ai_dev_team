/**
 * 作成できるものの範囲（画面表示用）。
 * PM の判断基準は api の SCOPE_RULES（apps/api/src/ai.ts）。内容を変えるときは両方を揃える。
 */
export const SUPPORTED_TARGETS = [
	"ブラウザだけで動く小さな Web アプリ（データは localStorage に保存）",
	"単機能のスクリプトや CLI ツール",
	"数画面程度のフロントエンド、または小さな API",
] as const;

export const UNSUPPORTED_EXAMPLES =
	"ログイン機能、外部データベース、決済、リアルタイム通信、複数サービス構成の業務システムなど、規模の大きいアプリは作成できません。";
