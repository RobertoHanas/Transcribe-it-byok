import { useState } from "react";
import { Eye, EyeOff, Key } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function ApiKeyInput({ value, onChange }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
      <Key size={16} className="text-slate-400 shrink-0" />
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-..."
        className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 font-mono"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="text-slate-400 hover:text-slate-600 transition-colors"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
