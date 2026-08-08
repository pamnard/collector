import { useCallback, useState } from "react";
import type { NavigateFunction } from "react-router-dom";

export type UseCreateItemShellInput = {
  bumpVaultRevision: () => void;
  navigate: NavigateFunction;
};

export type UseCreateItemShellResult = {
  isCreateOpen: boolean;
  createFolderPath: string | null;
  openCreate: (folderPath?: string) => void;
  closeCreate: () => void;
  handleCreated: (itemId: string) => void;
};

export function useCreateItemShell({
  bumpVaultRevision,
  navigate,
}: UseCreateItemShellInput): UseCreateItemShellResult {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);

  const openCreate = useCallback((folderPath?: string) => {
    // Header wires onClick={openCreate}; the click event must not become folder_path.
    setCreateFolderPath(typeof folderPath === "string" ? folderPath : null);
    setIsCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setIsCreateOpen(false);
    setCreateFolderPath(null);
  }, []);

  const handleCreated = useCallback(
    (itemId: string) => {
      setIsCreateOpen(false);
      setCreateFolderPath(null);
      bumpVaultRevision();
      navigate(`/item/${itemId}`);
    },
    [bumpVaultRevision, navigate],
  );

  return {
    isCreateOpen,
    createFolderPath,
    openCreate,
    closeCreate,
    handleCreated,
  };
}
