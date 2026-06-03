import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getModels,
  type ModelInfo,
  type ProviderBadge,
  type ProviderInfo,
} from "@/lib/api";

const LAST_MODEL_KEY = "paperpilot.lastModel";
const FALLBACK_BADGE: ProviderBadge = { label: "Unknown", color: "#888888" };

interface ModelContextValue {
  providers: ProviderInfo[];
  models: ModelInfo[];
  modelsByProvider: Record<string, ModelInfo[]>;
  selectedId: string | null;
  selectedModel: ModelInfo | null;
  setSelected: (id: string) => void;
  getBadge: (providerId: string) => ProviderBadge;
  loading: boolean;
  error: string | null;
}

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(LAST_MODEL_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await getModels();
        if (cancelled) return;
        setProviders(payload.providers);
        setModels(payload.models);
        setSelectedId((prev) => {
          if (prev && payload.models.some((m) => m.id === prev)) return prev;
          if (
            payload.default_model_id &&
            payload.models.some((m) => m.id === payload.default_model_id)
          ) {
            return payload.default_model_id;
          }
          return payload.models[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSelected = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(LAST_MODEL_KEY, id);
  }, []);

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ModelInfo[]> = {};
    for (const p of providers) grouped[p.id] = [];
    for (const m of models) {
      if (!grouped[m.provider]) grouped[m.provider] = [];
      grouped[m.provider].push(m);
    }
    return grouped;
  }, [providers, models]);

  const badgeMap = useMemo(() => {
    const map: Record<string, ProviderBadge> = {};
    for (const p of providers) map[p.id] = p.badge;
    return map;
  }, [providers]);

  const getBadge = useCallback(
    (providerId: string) => badgeMap[providerId] ?? FALLBACK_BADGE,
    [badgeMap],
  );

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  );

  const value = useMemo<ModelContextValue>(
    () => ({
      providers,
      models,
      modelsByProvider,
      selectedId,
      selectedModel,
      setSelected,
      getBadge,
      loading,
      error,
    }),
    [
      providers,
      models,
      modelsByProvider,
      selectedId,
      selectedModel,
      setSelected,
      getBadge,
      loading,
      error,
    ],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useModels(): ModelContextValue {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useModels must be used inside <ModelProvider>");
  return ctx;
}
