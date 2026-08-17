/**
 * import mapの`react`が指す固定名エントリ。**ファイル名を変えない。**
 *
 * プラグインはReactをexternalとしてビルドし、実体はここから受け取る。
 * 同梱するとインスタンスが二重になりhooksが壊れる。
 *
 * **`export *`を使わない。** ReactはCJSであり、`export *`はバンドラが付けた
 * 内部名をそのまま再輸出するため、minifyで`a`・`b`のような名前になって
 * `useState`が消える。名前を1つずつ書くことが、この契約の中身である。
 */
export {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version
} from "react";
