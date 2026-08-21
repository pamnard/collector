import { useCallback, useState } from "react";
import type { NavigateFunction } from "react-router-dom";

export type UseCreateItemShellInput = {
  navigate: NavigateFunction;
};

export type UseCreateItemShellResult = {
  isCreateOpen: boolean;
  createFolderPath: string | undefined;
  openCreate: (folderPath?: string) => void;
  closeCreate: () => void;
  handleCreated: (itemId: string) => void;
};

export function useCreateItemShell({
  navigate,
}: UseCreateItemShellInput): UseCreateItemShellResult {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFolderPath, setCreateFolderPath] = useState<
    string | undefined
  >(undefined);

  const openCreate = useCallback((folderPath?: string) => {
    setCreateFolderPath(folderPath);
    setIsCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setIsCreateOpen(false);
    setCreateFolderPath(undefined);
  }, []);

  const handleCreated = useCallback(
    (itemId: string) => {
      setIsCreateOpen(false);
      setCreateFolderPath(undefined);
      // Presentation events apply scoped live updates (#756); no full wipe.
      navigate(`/item/${itemId}`);
    },
    [navigate],
  );

  return {
    isCreateOpen,
    createFolderPath,
    openCreate,
    closeCreate,
    handleCreated,
  };
}
