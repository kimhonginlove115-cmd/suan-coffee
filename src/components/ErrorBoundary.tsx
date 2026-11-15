import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMsg: error?.message || 'មានបញ្ហាបច្ចេកទេសបណ្តោះអាសន្ន',
    };
  }

  componentDidCatch(error: Error) {
    console.error('App ErrorBoundary caught:', error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    try {
      window.localStorage.removeItem('cafe_menu_v15');
      window.localStorage.removeItem('cafe_toppings_v15');
      window.localStorage.removeItem('cafe_settings_v15');
      window.localStorage.removeItem('cafe_orders_v15');
      window.sessionStorage.removeItem('cafe_admin_token');
    } catch {
      // ignore storage failure
    }
    window.location.href = window.location.pathname;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F6F8F7] flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-3xl border border-slate-200 shadow-xl p-6 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-2xl font-bold">
              !
            </div>
            <h2 className="text-lg font-bold text-slate-900">កម្មវិធីជួបបញ្ហាបណ្តោះអាសន្ន</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              សូមចុចផ្ទុកទំព័រឡើងវិញ ឬសម្អាត Cache ដើម្បីដំណើរការជាធម្មតា។
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-2.5 rounded-xl text-xs"
              >
                ផ្ទុកទំព័រឡើងវិញ
              </button>
              <button
                type="button"
                onClick={this.handleResetCache}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs"
              >
                សម្អាត Cache ហើយបើកសាជាថ្មី
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
