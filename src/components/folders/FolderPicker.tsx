import { useMemo } from "react";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { useShell } from "../layout/AppLayout";
import { useFolderTree } from "../../hooks/useFolderTree";
import { collectFolderPathsFlat, sortFolderPathsFlat } from "../../lib/folder-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface FolderPickerProps {
  value: string;
  onChange: (folderPath: string) => void;
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const { vaultRevision } = useShell();
  const tree = useFolderTree(vaultRevision);
  const paths = useMemo(() => {
    const collected = collectFolderPathsFlat(tree);
    if (
      collected.some(
        (path) => path.toLowerCase() === INBOX_FOLDER_NAME.toLowerCase(),
      )
    ) {
      return collected;
    }
    return sortFolderPathsFlat([...collected, INBOX_FOLDER_NAME]);
  }, [tree]);

  const selectValue = value || INBOX_FOLDER_NAME;
  const items = useMemo(
    () => paths.map((path) => ({ value: path, label: path })),
    [paths],
  );

  return (
    <div>
      <span className="text-sm font-medium">Папка</span>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (typeof next !== "string") {
            throw new Error("folder_path must be a string");
          }
          onChange(next);
        }}
        items={items}
      >
        <SelectTrigger className="mt-1 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
