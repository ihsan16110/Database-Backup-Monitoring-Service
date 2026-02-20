import { useState, useEffect, useCallback, useRef } from "react";
import { fetchData } from "../services/apiServices";

const useFetch = (endpoint: string) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const activeEndpoint = useRef(endpoint);

  // Always track the latest endpoint so stale responses are ignored
  activeEndpoint.current = endpoint;

  const getData = useCallback(async () => {
    const requestedEndpoint = endpoint;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchData(requestedEndpoint);
      // Only update state if this is still the active endpoint
      if (activeEndpoint.current === requestedEndpoint) {
        setData(result);
      }
    } catch (err) {
      if (activeEndpoint.current === requestedEndpoint) {
        setError("Failed to fetch data");
      }
    } finally {
      if (activeEndpoint.current === requestedEndpoint) {
        setLoading(false);
      }
    }
  }, [endpoint]);

  useEffect(() => {
    getData();
  }, [getData]);

  return { data, loading, error, refetch: getData };
};

export default useFetch;
