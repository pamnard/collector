import { useCallback, useState } from "react";
import type { NavigateFunction } from "react-router-dom";

export type UseCreateItemShellInput = {
  bumpVaultRevision: () => void;
  navigate: NavigateFunction;
};

export type UseCreateItemShellResult = {
  isCreateOpen: boolean;
  openCreate: () => void;
  closeCreate: () => void;
  handleCreated: (itemId: string) => void;
};

export function useCreateItemShell({
  bumpVaultRevision,
  navigate,
}: UseCreateItemShellInput): UseCreateItemShellResult {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const openCreate = useCallback(() => {
    setIsCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setIsCreateOpen(false);
  }, []);

  const handleCreated = useCallback(
    (itemId: string) => {
      setIsCreateOpen(false);
      bumpVaultRevision();
      navigate(`/item/${itemId}`);
    },
    [bumpVaultRevision, navigate],
  );

  return {
    isCreateOpen,
    openCreate,
    closeCreate,
    handleCreated,
  };
}
