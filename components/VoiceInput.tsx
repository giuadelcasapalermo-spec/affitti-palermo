'use client';

import { useState, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

/* Dichiarazioni per Web Speech API (non sempre incluse nel dom lib) */
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
  interface SpeechRecognitionInstance {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
    onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
    start(): void;
    stop(): void;
  }
  interface SpeechRecognitionResultEvent {
    results: SpeechRecognitionResultList;
  }
  interface SpeechRecognitionErrorEvent {
    error: string;
  }
}

type Stato = 'idle' | 'ascolto' | 'elaborazione' | 'errore';

interface Props {
  tipo: 'prenotazione' | 'uscita' | 'entrata';
  camere: { id: number; nome: string }[];
  onParsed: (data: Record<string, unknown>) => void;
}

export default function VoiceInput({ tipo, camere, onParsed }: Props) {
  const [stato, setStato] = useState<Stato>('idle');
  const [errore, setErrore] = useState('');
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  function avvia() {
    const SR = typeof window !== 'undefined'
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
      : null;

    if (!SR) {
      setErrore('Browser non supportato (usa Chrome o Edge)');
      setStato('errore');
      return;
    }

    const rec = new SR();
    rec.lang = 'it-IT';
    rec.continuous = false;
    rec.interimResults = false;
    recRef.current = rec;

    rec.onresult = async (e: SpeechRecognitionResultEvent) => {
      const testo = e.results[0][0].transcript;
      setStato('elaborazione');
      try {
        const res = await fetch('/api/voice/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testo, tipo, camere }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.errore ?? 'Errore');
        onParsed(json);
        setStato('idle');
      } catch (err) {
        setErrore(err instanceof Error ? err.message : 'Errore elaborazione');
        setStato('errore');
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech') {
        setErrore('Nessun audio rilevato, riprova');
      } else if (e.error === 'not-allowed') {
        setErrore('Permesso microfono negato');
      } else {
        setErrore('Errore microfono');
      }
      setStato('errore');
    };

    rec.start();
    setStato('ascolto');
    setErrore('');
  }

  function ferma() {
    recRef.current?.stop();
    setStato('idle');
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {stato === 'idle' && (
        <button
          type="button"
          onClick={avvia}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
        >
          <Mic size={13} />
          Inserisci con la voce
        </button>
      )}

      {stato === 'ascolto' && (
        <button
          type="button"
          onClick={ferma}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg animate-pulse"
        >
          <MicOff size={13} />
          In ascolto… clicca per fermare
        </button>
      )}

      {stato === 'elaborazione' && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg bg-gray-50">
          <Loader2 size={13} className="animate-spin" />
          Elaborazione AI…
        </span>
      )}

      {stato === 'errore' && (
        <>
          <span className="text-xs text-red-600">{errore}</span>
          <button
            type="button"
            onClick={() => setStato('idle')}
            className="text-xs text-purple-600 underline hover:text-purple-800"
          >
            Riprova
          </button>
        </>
      )}
    </div>
  );
}
