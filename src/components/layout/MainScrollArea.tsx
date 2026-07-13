import { useLayoutEffect, useRef, type ReactNode } from "react";

interface MainScrollAreaProps {
  children: ReactNode;
  contentInsetClass: string;
  gutterCoverClass: string;
  gutterInsetClass: string;
}

export function MainScrollArea({
  children,
  contentInsetClass,
  gutterCoverClass,
  gutterInsetClass,
}: MainScrollAreaProps) {
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const gutterScrollRef = useRef<HTMLDivElement>(null);
  const gutterSpacerRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  useLayoutEffect(() => {
    const contentScroll = contentScrollRef.current;
    const gutterScroll = gutterScrollRef.current;
    if (!contentScroll || !gutterScroll) {
      return;
    }

    const onContentScroll = () => {
      if (isSyncingRef.current) {
        return;
      }
      isSyncingRef.current = true;
      gutterScroll.scrollTop = contentScroll.scrollTop;
      isSyncingRef.current = false;
    };

    const onGutterScroll = () => {
      if (isSyncingRef.current) {
        return;
      }
      isSyncingRef.current = true;
      contentScroll.scrollTop = gutterScroll.scrollTop;
      isSyncingRef.current = false;
    };

    contentScroll.addEventListener("scroll", onContentScroll, { passive: true });
    gutterScroll.addEventListener("scroll", onGutterScroll, { passive: true });

    return () => {
      contentScroll.removeEventListener("scroll", onContentScroll);
      gutterScroll.removeEventListener("scroll", onGutterScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const contentScroll = contentScrollRef.current;
    const gutterScroll = gutterScrollRef.current;
    const gutterSpacer = gutterSpacerRef.current;
    if (!contentScroll || !gutterScroll || !gutterSpacer) {
      return;
    }

    const updateGutterSpacer = () => {
      const spacerHeight =
        contentScroll.scrollHeight -
        contentScroll.clientHeight +
        gutterScroll.clientHeight;
      gutterSpacer.style.height = `${spacerHeight}px`;
    };

    updateGutterSpacer();

    const resizeObserver = new ResizeObserver(updateGutterSpacer);
    resizeObserver.observe(contentScroll);
    const contentInner = contentScroll.firstElementChild;
    if (contentInner) {
      resizeObserver.observe(contentInner);
    }

    return () => resizeObserver.disconnect();
  }, [contentInsetClass, children]);

  return (
    <>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={contentScrollRef}
          className="scrollbar-none absolute inset-0 overflow-y-auto overflow-x-hidden"
        >
          <div className={contentInsetClass}>{children}</div>
        </div>
      </div>

      <div className="relative min-h-0 w-[14px] shrink-0 self-stretch">
        <div
          aria-hidden
          className={`absolute inset-x-0 top-0 bg-main ${gutterCoverClass}`}
        />
        <div
          ref={gutterScrollRef}
          className={`main-scrollbar absolute inset-x-0 bottom-0 overflow-y-auto overflow-x-hidden ${gutterInsetClass}`}
        >
          <div ref={gutterSpacerRef} aria-hidden className="w-px shrink-0" />
        </div>
      </div>
    </>
  );
}
