/**
 * TabErrorBoundary — 工具頁級錯誤邊界
 *
 * 2026-08-19 教訓：RU panel 拿到非預期 API shape 時 render throw，
 * 沒有 error boundary → 整棵 React 樹 unmount → 白屏，且 tab 存在
 * localStorage → 重開 app 又還原又炸（crash loop，進不去 coding app）。
 *
 * 邊界只包單一工具頁：炸了顯示「此頁發生錯誤 + 重試」，其他 tab 不受影響。
 */
import React from "react";

interface Props {
  label?: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class TabErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message || String(err) };
  }

  componentDidCatch(err: Error) {
    console.error("[TabErrorBoundary]", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center border border-red-200 bg-red-50 rounded-xl p-6">
            <div className="text-3xl mb-2">⚠️</div>
            <h3 className="text-sm font-bold text-red-700 mb-1">
              {this.props.label || "此工具頁"}發生錯誤
            </h3>
            <p className="text-[11px] text-red-500 font-mono break-all mb-4">{this.state.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="text-xs px-4 py-2 rounded-lg text-white bg-red-500 hover:bg-red-600"
            >
              🔄 重試
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
