import { useModels } from "./ModelProvider";

interface ModelPickerProps {
  disabled?: boolean;
}

export default function ModelPicker({ disabled }: ModelPickerProps) {
  const { providers, modelsByProvider, selectedId, setSelected, loading, getBadge } =
    useModels();

  if (loading) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        Loading models…
      </span>
    );
  }

  const hasAny = providers.some((p) => (modelsByProvider[p.id]?.length ?? 0) > 0);
  if (!hasAny) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        No models available
      </span>
    );
  }

  const selectedProvider = providers.find((p) =>
    modelsByProvider[p.id]?.some((m) => m.id === selectedId),
  );
  const selectedBadge = selectedProvider ? getBadge(selectedProvider.id) : null;

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">Model</span>
      {selectedBadge && (
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: selectedBadge.color }}
        />
      )}
      <select
        value={selectedId ?? ""}
        onChange={(e) => setSelected(e.target.value)}
        disabled={disabled}
        className="rounded-md border bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {providers.map((p) => {
          const group = modelsByProvider[p.id] ?? [];
          if (group.length === 0) return null;
          return (
            <optgroup key={p.id} label={p.display_name}>
              {group.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}
