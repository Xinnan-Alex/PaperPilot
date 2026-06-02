import type { ModelInfo } from "@/lib/api";

interface ModelPickerProps {
  models: ModelInfo[];
  selectedId: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

const PROVIDER_BADGE: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  groq: "Groq",
  mistral: "Mistral",
};

export default function ModelPicker({
  models,
  selectedId,
  onChange,
  disabled,
}: ModelPickerProps) {
  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        No models available
      </span>
    );
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">Model</span>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name} · {PROVIDER_BADGE[m.provider] ?? m.provider}
          </option>
        ))}
      </select>
    </label>
  );
}
