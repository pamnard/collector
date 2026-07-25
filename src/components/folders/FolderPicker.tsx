import { useMemo } from "react";
import {
  INBOX_FOLDER_NAME,
  compareFolderNamesForDisplay,
} from "@collector/shared";
import { useShell } from "../layout/AppLayout";
import { useFolderTree } from "../../hooks/useFolderTree";

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

  return (
    <label className="block">
      <span className="text-sm font-medium">Папка</span>
      <select
        value={selectValue}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      >
        {paths.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
    </label>
  );
}
