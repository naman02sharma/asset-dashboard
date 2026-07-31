import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';

/**
 * Counts a number up/down from its previous value to a new one
 * whenever `value` changes -- anime.js's animate() interpolates a
 * plain JS object (not a DOM node; this is anime's documented pattern
 * for animating a value that isn't a CSS property), and each tick's
 * onUpdate callback re-formats and pushes it into React state. Used
 * for the KPI cards so a value going from e.g. Rs 10,00,000 to
 * Rs 12,40,000 counts up instead of just snapping to the new number.
 *
 * Falls back gracefully: on first mount (no previous value to animate
 * from) it starts the count from 0 for a satisfying "reveal", but
 * skips the animation entirely if the value hasn't actually changed.
 */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 900 }) {
  const numericValue = Number(value) || 0;
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (hasMounted.current && prevValue.current === numericValue) return;
    hasMounted.current = true;

    const obj = { val: prevValue.current };
    const anim = animate(obj, {
      val: numericValue,
      duration,
      ease: 'outQuart',
      onUpdate: () => setDisplay(obj.val),
    });
    prevValue.current = numericValue;
    return () => anim.pause();
  }, [numericValue, duration]);

  return <>{format(display)}</>;
}
