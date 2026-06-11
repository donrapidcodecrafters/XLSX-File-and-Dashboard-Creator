import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Split into two contexts so viewers don't re-render when toolsNode changes
const ReaderToolsSetContext = createContext<(node: ReactNode) => void>(() => {});
const ReaderToolsNodeContext = createContext<ReactNode>(null);

export function ReaderToolsProvider({ children }: { children: ReactNode }) {
  const [toolsNode, setToolsNode] = useState<ReactNode>(null);
  const setTools = useCallback((node: ReactNode) => setToolsNode(node), []);
  return (
    <ReaderToolsSetContext.Provider value={setTools}>
      <ReaderToolsNodeContext.Provider value={toolsNode}>
        {children}
      </ReaderToolsNodeContext.Provider>
    </ReaderToolsSetContext.Provider>
  );
}

export function useSetReaderTools() {
  return useContext(ReaderToolsSetContext);
}

export function useReaderToolsNode() {
  return useContext(ReaderToolsNodeContext);
}
