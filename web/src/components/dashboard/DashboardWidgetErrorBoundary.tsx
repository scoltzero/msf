import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

type Props = { children: ReactNode; title: string };
type State = { failed: boolean };

export class DashboardWidgetErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Dashboard widget \"${this.props.title}\" failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <div><p className="text-sm font-medium">{this.props.title}暂时无法显示</p><p className="mt-1 text-xs text-muted-foreground">其他组件不受影响，可以单独重试。</p></div>
        <button type="button" className="gary-glass-button gap-1.5 rounded-xl px-3 py-2 text-xs" onClick={() => this.setState({ failed: false })}><RotateCw className="h-3.5 w-3.5" />重试</button>
      </div>
    );
  }
}
