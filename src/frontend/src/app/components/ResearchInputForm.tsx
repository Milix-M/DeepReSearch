import type { FormEvent, RefObject } from "react";

interface ResearchInputFormProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  isConnecting: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearchInputForm({
  inputRef,
  value,
  isConnecting,
  onChange,
  onSubmit,
}: ResearchInputFormProps) {
  return (
    <footer className="shrink-0 border-t border-slate-900/70 px-6 py-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder="調べたい内容を入力"
          className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 shadow-inner focus:border-emerald-400 focus:outline-none"
          disabled={isConnecting}
        />
        <div className="flex items-center justify-between">
          <div className="flex-1" />
          <button
            type="submit"
            disabled={isConnecting || value.trim().length === 0}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-500 bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500 hover:border-emerald-400 hover:bg-emerald-400"
          >
            {isConnecting ? "接続中..." : "リサーチ開始"}
          </button>
        </div>
      </form>
    </footer>
  );
}
