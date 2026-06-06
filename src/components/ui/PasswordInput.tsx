"use client";
import { useState, type InputHTMLAttributes } from "react";

// Password input with a show/hide (eye) toggle. `wrap` carries any layout classes
// (e.g. "col-span-2") that must stay on the field's grid/flex slot.
export default function PasswordInput({ className = "", wrap = "relative", ...rest }: { wrap?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className={wrap}>
      <input {...rest} type={show ? "text" : "password"} className={className + " w-full pr-9"} />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} aria-label="Show or hide password"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-200">
        <i className={"fa-solid " + (show ? "fa-eye-slash" : "fa-eye")} style={{ fontSize: 13 }} />
      </button>
    </div>
  );
}
