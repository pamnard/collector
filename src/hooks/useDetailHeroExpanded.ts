import { useState } from "react";
import {
  readDetailHeroExpanded,
  writeDetailHeroExpanded,
} from "../lib/detail-hero-expanded";

export function useDetailHeroExpanded() {
  const [expanded, setExpandedState] = useState(readDetailHeroExpanded);

  function setExpanded(next: boolean) {
    writeDetailHeroExpanded(next);
    setExpandedState(next);
  }

  return { expanded, setExpanded };
}
