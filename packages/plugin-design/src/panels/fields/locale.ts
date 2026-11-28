import { createContext, useContext } from "react";

export const InspectorLocale = createContext<"ja" | "en">("en");
export const useInspectorLocale = () => useContext(InspectorLocale);
