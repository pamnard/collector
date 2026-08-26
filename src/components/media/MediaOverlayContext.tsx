import { createContext, useContext, type ReactNode } from "react";

type MediaOverlayContextValue = {
  openImage: (src: string, title?: string) => void;
};

const MediaOverlayContext = createContext<MediaOverlayContextValue | null>(null);

export function MediaOverlayProvider({
  children,
  openImage,
}: {
  children: ReactNode;
  openImage: (src: string, title?: string) => void;
}) {
  return (
    <MediaOverlayContext.Provider value={{ openImage }}>
      {children}
    </MediaOverlayContext.Provider>
  );
}

/** Null outside detail overlay provider — markdown images stay static. */
export function useMediaOverlay(): MediaOverlayContextValue | null {
  return useContext(MediaOverlayContext);
}
