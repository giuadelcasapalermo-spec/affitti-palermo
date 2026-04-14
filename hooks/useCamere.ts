'use client';

import { useState, useEffect } from 'react';
import { Camera, CAMERE } from '@/lib/types';

export function useCamere(): Camera[] {
  const [camere, setCamere] = useState<Camera[]>(CAMERE);

  useEffect(() => {
    fetch('/api/camere')
      .then((r) => r.json())
      .then(setCamere);
  }, []);

  return camere;
}
