import { useEffect, useState } from "react";
import { listFolderTree } from "../../services/collector-service";

interface FolderPickerProps {
  value: string;
  onChange: (folderPath: string) => void;
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    listFolderTree()
      .then((tree) => {
        const collected: string[] = [];
        const walk = (nodes: typeof tree) => {
          for (const node of nodes) {
            collected.push(node.path);
            walk(node.children);
          }
        };
        walk(tree);
        setPaths(collected.sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => setPaths([]));
  }, []);

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
