"use client";

type FullscreenLoadingProps = {
  message?: string;
};

export default function FullscreenLoading({ message }: FullscreenLoadingProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/95">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500" aria-hidden="true" />
        {message ? <p className="text-sm font-medium text-orange-700">{message}</p> : null}
      </div>
    </div>
  );
}
