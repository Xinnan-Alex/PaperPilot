import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
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

// The four values fetched together from the models API form one state slice:
// they always move as a group (loading → loaded/failed), so a reducer keeps
// those transitions atomic instead of spread across four useState setters.
interface FetchState {
  providers: ProviderInfo[];
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
}

type FetchAction =
  | { type: "loaded"; providers: ProviderInfo[]; models: ModelInfo[] }
  | { type: "failed"; error: string };

const initialFetchState: FetchState = {
  providers: [],
  models: [],
  loading: true,
  error: null,
};

function fetchReducer(state: FetchState, action: FetchAction): FetchState {
  switch (action.type) {
    case "loaded":
      return {
        providers: action.providers,
        models: action.models,
        loading: false,
        error: null,
      };
    case "failed":
      return { ...state, loading: false, error: action.error };
  }
}

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
  const [{ providers, models, loading, error }, dispatch] = useReducer(
    fetchReducer,
    initialFetchState,
  );
  // selectedId is independent of the fetch slice — it survives across loads,
  // is seeded from localStorage, and is driven by user choice — so it stays
  // its own useState rather than being folded into the reducer.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(LAST_MODEL_KEY),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await getModels();
        if (cancelled) return;
        dispatch({
          type: "loaded",
          providers: payload.providers,
          models: payload.models,
        });
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
        if (!cancelled) {
          dispatch({
            type: "failed",
            error: err instanceof Error ? err.message : "failed",
          });
        }
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
  const ctx = use(ModelContext);
  if (!ctx) throw new Error("useModels must be used inside <ModelProvider>");
  return ctx;
}
