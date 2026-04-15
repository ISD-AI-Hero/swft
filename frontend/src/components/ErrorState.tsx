// Generic inline error panel for failed fetches/forms.
export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
    <p className="font-medium">Something went wrong</p>
    <p className="text-sm text-rose-600 dark:text-rose-300">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1"
      >
        Try again
      </button>
    )}
  </div>
);
