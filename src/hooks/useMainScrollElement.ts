import { useEffect, useState } from "react";

export function useMainScrollElement(): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const node = document.querySelector(".main-scrollbar");
    setElement(node instanceof HTMLElement ? node : null);
  }, []);

  return element;
}
