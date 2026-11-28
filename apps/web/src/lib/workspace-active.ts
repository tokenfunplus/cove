import { createContext, useContext } from "react";

// Hidden Chat keeps its drafts and generation workers, but releases UI input.
export const WorkspaceActiveContext = createContext(true);
export const useWorkspaceActive = () => useContext(WorkspaceActiveContext);
