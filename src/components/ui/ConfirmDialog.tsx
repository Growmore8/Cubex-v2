"use client";
import { useState, useCallback } from "react";

type ConfirmOpts = { title?: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = ConfirmOpts & { placeholder?: string; defaultValue?: string; password?: boolean };

type State =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void; value: string }
  | null;

/**
 * Promise-based replacement for window.confirm / window.prompt rendered with the
 * platform's own UI. Usage:
 *   const { confirm, prompt, node } = useDialog();
 *   ...
 *   if (await confirm({ message: "Delete?" , danger: true })) doThing();
 *   const pw = await prompt({ title: "New password", password: true });
 *   return <>{node}{...}</>;
 */
export function useDialog() {
  const [state, setState] = useState<State>(null);

  const confirm = useCallback((opts: ConfirmOpts = {}) =>
    new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })), []);

  const prompt = useCallback((opts: PromptOpts = {}) =>
    new Promise<string | null>((resolve) => setState({ kind: "prompt", opts, resolve, value: opts.defaultValue || "" })), []);

  function close(result: any) {
    if (!state) return;
    (state.resolve as any)(result);
    setState(null);
  }

  const node = state ? (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div className="ui-card ui-pop w-[380px] p-5" onClick={(e) => e.stopPropagation()}>
        {state.opts.title && <div className="mb-1 text-sm font-semibold">{state.opts.title}</div>}
        {state.opts.message && <div className="mb-4 text-xs text-[var(--muted-foreground)] whitespace-pre-line">{state.opts.message}</div>}
        {state.kind === "prompt" && (
          <input
            autoFocus
            type={(state.opts as PromptOpts).password ? "password" : "text"}
            placeholder={(state.opts as PromptOpts).placeholder || ""}
            value={state.value}
            onChange={(e) => setState({ ...state, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") close(state.value); if (e.key === "Escape") close(null); }}
            className="ui-input mb-4 w-full px-3 py-2 text-sm"
          />
        )}
        <div className="flex justify-end gap-3">
          <button className="ui-btn ui-btn-ghost px-3 py-1.5 text-sm" onClick={() => close(state.kind === "prompt" ? null : false)}>{state.opts.cancelLabel || "Cancel"}</button>
          <button
            className={"ui-btn px-3 py-1.5 text-sm text-white " + (state.opts.danger ? "bg-red-600" : "ui-btn-primary")}
            onClick={() => close(state.kind === "prompt" ? state.value : true)}
          >{state.opts.confirmLabel || (state.kind === "prompt" ? "Save" : state.opts.danger ? "Delete" : "Confirm")}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, prompt, node };
}
