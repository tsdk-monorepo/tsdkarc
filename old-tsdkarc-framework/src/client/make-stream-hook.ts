import { useState, useCallback, useRef } from "react";

// The internal hook logic
export function makeStreamHook(
  fn: (...args: any[]) => AsyncGenerator<any, any, any>
) {
  return function (defaultData?: unknown) {
    const [data, setData] = useState<any[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // Use a ref to prevent overlapping streams if called twice
    const activeStream = useRef<boolean>(false);

    const start = useCallback(
      async (overrideData?: unknown) => {
        if (activeStream.current) return;

        activeStream.current = true;
        setIsStreaming(true);
        setError(null);
        setData([]); // Clear previous chunks

        try {
          // Call the base client's stream function
          const generator = fn(overrideData ?? defaultData);
          for await (const chunk of generator) {
            setData((prev) => [...prev, chunk]);
          }
        } catch (err: any) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsStreaming(false);
          activeStream.current = false;
        }
      },
      [defaultData]
    );

    const reset = useCallback(() => {
      setData([]);
      setError(null);
    }, []);

    return { data, isStreaming, error, start, reset };
  };
}
