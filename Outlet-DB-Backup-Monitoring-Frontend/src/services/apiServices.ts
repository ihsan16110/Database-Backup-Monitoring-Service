import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "/api/v1",
  timeout: 300000,
});

// Attach JWT token to every request
api.interceptors.request.use((config: any) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 responses, clear auth state and redirect to login
api.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/backup-monitor/login";
    }
    return Promise.reject(error);
  }
);

export const fetchData = async (endpoint: string) => {
  try {
    const response = await api.get(endpoint);
    return response.data;
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
};

export const syncOutlets = async (outletCodes: string[]) => {
  const response = await api.post("/backup-status/sync", {
    outlets: outletCodes,
  });
  return response.data;
};

export const syncIBStorageOutlets = async (outletCodes: string[]) => {
  const response = await api.post("/ibstorage-status/sync", {
    outlets: outletCodes,
  });
  return response.data;
};

export const loginUser = async (userId: string, password: string): Promise<any> => {
  const response = await api.post("/auth/login", { userId, password });
  return response.data;
};

export const fetchCurrentUser = async (): Promise<any> => {
  const response = await api.get("/auth/me");
  return response.data;
};
