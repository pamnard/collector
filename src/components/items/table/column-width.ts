export function columnWidthClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return "w-10";
    case "content_type":
      return "w-28";
    case "tags":
      return "w-40";
    case "created_at":
    case "updated_at":
      return "w-28";
    case "actions":
      return "w-16";
    default:
      return "";
  }
}
