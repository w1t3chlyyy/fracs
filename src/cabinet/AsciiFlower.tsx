import { useEffect, useRef } from 'react';
import { createFlowerEngine } from './flowerEngine';

/* AsciiFlower — ASCII-цветок справа на экране входа (по референсу «ASCII-цветок»).
 * Canvas 720×704, сетка 120×64 символов: цветок распускается из бутона за ~7 с
 * (стебель → листья → головка), затем бесконечно плавно вращается по кругу.
 * respects prefers-reduced-motion: статичный распустившийся кадр. */
export default function AsciiFlower({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return createFlowerEngine(cv, reduced);
  }, []);

  return (
    <canvas
      ref={ref}
      width={720}
      height={704}
      aria-hidden
      className={`select-none block bg-black ${className}`}
      style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
    />
  );
}
