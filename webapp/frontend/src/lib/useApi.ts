import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./api";

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const tick = useRef(0);

  const load = useCallback(() => {
    if (!path) return () => {};
    const ctrl = new AbortController();
    const id = ++tick.current;
    setLoading(true); setError(null);
    get<T>(path, ctrl.signal)
      .then((d) => { if (id === tick.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (e?.name !== "AbortError" && id === tick.current) { setError(e); setLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => load(), [load]);
  return { data, error, loading, reload: load };
}
