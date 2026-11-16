'use client';

import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Botão de correção em dois toques: o primeiro pede confirmação, o segundo executa. */
export function ConfirmButton({ onConfirm, confirmLabel = 'Confirmar?', children, ...props }: ButtonProps & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...props}
      variant={armed ? 'destructive' : props.variant}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
