import { createContext, useContext } from "react";

export type SettingsSection = "general" | "provider" | "chat-data" | "web-search" | "local-models" | "network";
export const SettingsNavigation = createContext<((section: SettingsSection) => void) | undefined>(undefined);
export const useSettingsNavigation = () => useContext(SettingsNavigation);
