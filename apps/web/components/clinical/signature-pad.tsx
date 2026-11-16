'use client';

// Quadro de assinatura com o dedo (celular) ou mouse. Devolve PNG em data URL.
import { Eraser } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function SignaturePad({ onChange, height = 180 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);
  const notify = useRef(onChange);
  notify.current = onChange;

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = c.parentElement!.clientWidth;
    c.width = w * ratio;
    c.height = height * ratio;
    c.style.width = `${w}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#0D1F3A';
    strokes.current = 0;
    setEmpty(true);
    notify.current(null);
  }, [height]);

  useEffect(() => {
    setup();
  }, [setup]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#0D1F3A';
    ctx.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    strokes.current++;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (strokes.current > 8) {
      setEmpty(false);
      notify.current(canvas.current!.toDataURL('image/png'));
    }
  };

  return (
    <div className="space-y-1">
      <div className="relative rounded-lg border-2 border-dashed border-navy-200 bg-white">
        <canvas
          ref={canvas}
          className="block touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label="Quadro de assinatura"
        />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Assine aqui com o dedo</p>}
        <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-300" />
      </div>
      <button type="button" onClick={setup} className="inline-flex items-center gap-1 text-xs text-navy-600 hover:underline">
        <Eraser className="size-3.5" /> Limpar e assinar de novo
      </button>
    </div>
  );
}
