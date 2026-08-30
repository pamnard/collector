import { CreateItemDialog } from "../items/CreateItemDialog";
import { AlertHost } from "../alerts/AlertHost";

export type AppLayoutOverlaysProps = {
  isCreateOpen: boolean;
  createFolderPath: string | undefined;
  onCloseCreate: () => void;
  onCreated: (itemId: string) => void;
};

/** Shell overlays owned by AppLayout (alerts + create-item dialog). */
export function AppLayoutOverlays({
  isCreateOpen,
  createFolderPath,
  onCloseCreate,
  onCreated,
}: AppLayoutOverlaysProps) {
  return (
    <>
      <AlertHost />

      <CreateItemDialog
        open={isCreateOpen}
        onOpenChange={(next) => {
          if (!next) {
            onCloseCreate();
          }
        }}
        onCreated={onCreated}
        initialFolderPath={createFolderPath}
      />
    </>
  );
}
