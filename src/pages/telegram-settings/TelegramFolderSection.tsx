import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type FolderItem = { value: string; label: string };

type Props = {
  folderPath: string;
  folderItems: FolderItem[];
  busy: boolean;
  loading: boolean;
  changeFolder: (next: string) => Promise<void>;
};

export function TelegramFolderSection({
  folderPath,
  folderItems,
  busy,
  loading,
  changeFolder,
}: Props) {
  return (
    <div className="p-4">
      <p className="font-medium">Папка назначения</p>
      <Select
        value={folderPath}
        onValueChange={(value) => {
          void changeFolder(value);
        }}
        disabled={busy || loading}
        items={folderItems}
      >
        <SelectTrigger className="mt-2 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {folderItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
