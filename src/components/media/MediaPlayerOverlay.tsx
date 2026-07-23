import { X } from "lucide-react";
import { useEffect } from "react";
import type { PlayableMediaKind } from "../../utils/local-media-playback";

export interface MediaPlayerOverlayProps {
  src: string;
  kind: PlayableMediaKind;
  onClose: () => void;
  title?: string;
}

/**
 * Full-viewport overlay for local vault video/audio (native HTML5 controls).
 * No inner card — media fills the available space; X sits on the overlay.
 * ESC + click on empty backdrop close. Nothing plays while unmounted.
 */
export function MediaPlayerOverlay({
  src,
  kind,
  onClose,
  title,
}: MediaPlayerOverlayProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? (kind === "video" ? "Видео" : "Аудио")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 z-20 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Закрыть плеер"
      >
        <X size={24} />
      </button>

      {kind === "video" ? (
        <video
          key={src}
          src={src}
          controls
          autoPlay
          onClick={(event) => event.stopPropagation()}
          className="relative z-10 h-full w-full object-contain"
        />
      ) : (
        <audio
          key={src}
          src={src}
          controls
          autoPlay
          onClick={(event) => event.stopPropagation()}
          className="relative z-10 w-full max-w-3xl"
        />
      )}
    </div>
  );
}
