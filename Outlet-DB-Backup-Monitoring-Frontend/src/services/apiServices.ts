import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "/api/v1",
  timeout: 300000,
});

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
