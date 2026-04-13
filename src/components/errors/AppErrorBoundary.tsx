import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { BrandedFullPageError } from '../feedback/BrandedFullPageError';

interface AppErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps): void {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[MindWell][RenderErrorBoundary] Caught runtime render error', error, errorInfo);
    }
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <BrandedFullPageError
          title="The page crashed while rendering"
          message="Please retry. If this continues, sign in again to re-initialize your session."
          onRetry={this.retry}
          secondaryLabel="Reload App"
          secondaryOnClick={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
