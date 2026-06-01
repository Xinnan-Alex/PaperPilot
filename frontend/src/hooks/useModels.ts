import { useEffect, useState } from "react";
import { getModels, type ModelInfo } from "@/lib/api";

const LAST_MODEL_KEY = "paperpilot.lastModel";

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return localStorage.getItem(LAST_MODEL_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getModels();
        if (cancelled) return;
        setModels(list);
        setSelectedId((prev) => {
          if (prev && list.some((m) => m.id === prev)) return prev;
          return list[0]?.id ?? null;
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

  const setSelected = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(LAST_MODEL_KEY, id);
  };

  return { models, selectedId, setSelected, loading, error };
}
