"use client";

// A row of cards that swipe sideways one at a time (Nov 22, 2026: Training's
// heart-rate zones, then the body map). Labels above show which card is up
// and jump to one when tapped. Each card keeps its own height and the row
// takes the height of the card showing, so a short card isn't stretched or
// left with a gap under it.
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

export function SwipeGallery({ labels, children }: { labels: string[]; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const slides = Children.toArray(children);

  // Follow the showing card's height, also when it changes (a dropdown, a
  // tapped muscle, editing goals).
  useEffect(() => {
    const slide = track.current?.children[active] as HTMLElement | undefined;
    if (!slide) return;
    const measure = () => setHeight(slide.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slide);
    return () => observer.disconnect();
  }, [active]);

  const onScroll = () => {
    const element = track.current;
    if (!element) return;
    setActive(Math.round(element.scrollLeft / element.clientWidth));
  };
  const go = (index: number) => {
    const element = track.current;
    element?.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="swipe-gallery">
      <nav className="swipe-gallery-tabs" aria-label="Cards">
        {labels.map((label, index) => (
          <button key={label} type="button" aria-current={index === active ? "true" : undefined} onClick={() => go(index)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="swipe-gallery-track" ref={track} onScroll={onScroll} style={height ? { height } : undefined}>
        {slides.map((slide, index) => (
          <div key={index} className="swipe-gallery-slide">
            {slide}
          </div>
        ))}
      </div>
      <div className="swipe-gallery-dots" aria-hidden="true">
        {slides.map((_, index) => (
          <i key={index} className={index === active ? "active" : undefined} />
        ))}
      </div>
    </div>
  );
}
