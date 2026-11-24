import { request } from "./client";
import type { DownloadNetworkSettings, DownloadNetworkView, DownloadNetworkTest } from "@cove/api-contract";

export const getDownloadNetwork = () => request<DownloadNetworkView>("/api/network/settings");
const body = (settings: DownloadNetworkSettings) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
export const saveDownloadNetwork = (settings: DownloadNetworkSettings) => request<DownloadNetworkView>("/api/network/settings", { method: "PUT", ...body(settings) });
export const testDownloadNetwork = (settings: DownloadNetworkSettings) => request<DownloadNetworkTest>("/api/network/test", { method: "POST", ...body(settings) });
