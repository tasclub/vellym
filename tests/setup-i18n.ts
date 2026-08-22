// UIコンポーネントは react-i18next の useTranslation を使うため、i18next 未初期化だと
// t() がキー文字列をそのまま返す。i18n モジュールを読み込むと副作用で初期化されるので、
// レンダリングを伴うテストの前に一度だけ読み込んでおく。
import "../packages/ui-react/src/shared/i18n.js";
