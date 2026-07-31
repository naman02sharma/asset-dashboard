import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

/**
 * Subtle mouse-following 3D tilt, the tasteful/business-dashboard
 * version of the "3D card" effect popularized by libraries like
 * Aceternity UI -- hand-built here (not copied from any library) so
 * it stays a single small, auditable file with no extra dependency
 * beyond `motion` itself. maxTilt is deliberately small (default 5
 * degrees) -- enough to read as "interactive" without feeling like a
 * marketing-page gimmick on software people use to track purchase
 * orders all day.
 *
 * Wraps its children in two extra divs (perspective container +
 * rotated layer) but does NOT touch the children's own classNames --
 * any existing hover:-translate-y / hover:shadow effects on the card
 * itself keep working unchanged, since they're a different transform
 * on a different DOM node than the tilt rotation applied here.
 */
export function TiltCard({ children, className = '', maxTilt = 5 }) {
  const ref = useRef(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 200, damping: 22, mass: 0.5 };
  const rotateX = useSpring(useTransform(py, [0, 1], [maxTilt, -maxTilt]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-maxTilt, maxTilt]), spring);

  function handleMouseMove(e) {
    const rect = ref.current.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }
  function handleMouseLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <div ref={ref} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
      style={{ perspective: 800 }} className={className}>
      <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}>
        {children}
      </motion.div>
    </div>
  );
}
