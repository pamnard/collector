import { useMemo } from "react";
import { useShell } from "../layout/AppLayout";
import { useFolderTree } from "../../hooks/useFolderTree";

interface FolderPickerProps {
  value: string;
  onChange: (folderPath: string) => void;
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
    return collected.sort((a, b) => a.localeCompare(b));
  }, [tree]);

  return (
    <label className="block">
      <span className="text-sm font-medium">Папка</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
      >
        <option value="">Без папки</option>
        {paths.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
    </label>
  );
}
