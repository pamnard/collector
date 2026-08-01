import { useMemo } from "react";
import {
  INBOX_FOLDER_NAME,
  compareFolderNamesForDisplay,
} from "@collector/shared";
import { useShell } from "../layout/AppLayout";
import { useFolderTree } from "../../hooks/useFolderTree";
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

function folderPathSortKey(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const { vaultRevision } = useShell();
  const tree = useFolderTree(vaultRevision);
  const paths = useMemo(() => {
    const collected: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        collected.push(node.path);
        walk(node.children);
      }
    };
    walk(tree);
    if (
      !collected.some(
        (path) => path.toLowerCase() === INBOX_FOLDER_NAME.toLowerCase(),
      )
    ) {
      collected.push(INBOX_FOLDER_NAME);
    }
    return collected.sort((a, b) => {
      const root = compareFolderNamesForDisplay(
        folderPathSortKey(a),
        folderPathSortKey(b),
      );
      if (root !== 0) {
        return root;
      }
      return a.localeCompare(b);
    });
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
