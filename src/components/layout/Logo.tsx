import { FolderSymlink } from "lucide-react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeConfig = {
  sm: { icon: 24, text: "text-xl" },
  md: { icon: 28, text: "text-2xl" },
  lg: { icon: 40, text: "text-4xl" },
} as const;

export function Logo({ className = "", size = "md" }: LogoProps) {
  const { icon, text } = sizeConfig[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <FolderSymlink className="text-indigo-500" size={icon} />
      <span
        className={`${text} font-medium bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent`}
      >
        Collector
      </span>
    </div>
  );
}
