import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { BrandedFullPageError } from '../feedback/BrandedFullPageError';

interface AppErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message ?? String(error),
    };
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[MindWell][RenderErrorBoundary] Caught runtime render error', error, errorInfo);
  }

  private retry = (): void => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      const detail = this.state.errorMessage
        ? `Details: ${this.state.errorMessage}`
        : 'Please retry. If this continues, sign in again to re-initialize your session.';
      return (
        <BrandedFullPageError
          title="The page crashed while rendering"
          message={detail}
          onRetry={this.retry}
          secondaryLabel="Reload App"
          secondaryOnClick={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
