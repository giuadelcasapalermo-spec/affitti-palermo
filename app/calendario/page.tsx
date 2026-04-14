'use client';

import { useEffect, useState } from 'react';
import { Prenotazione } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { fData } from '@/lib/utils';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  parseISO,
  isSameDay,
  isWithinInterval,
  addMonths,
  subMonths,
  getDay,
  differenceInDays,
} from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Colors matching room names: Bianca(1), Gialla(2), Rossa(3), Verde(4), Blue(5)
const STILE_CAMERA: Record<number, { dot: string; pieno: string; leggero: string }> = {
  1: { dot: 'bg-sky-400',    pieno: 'bg-sky-400 text-white',     leggero: 'bg-sky-100 text-sky-600' },
  2: { dot: 'bg-amber-400',  pieno: 'bg-amber-400 text-white',   leggero: 'bg-amber-100 text-amber-600' },
  3: { dot: 'bg-red-500',    pieno: 'bg-red-500 text-white',     leggero: 'bg-red-100 text-red-600' },
  4: { dot: 'bg-green-500',  pieno: 'bg-green-500 text-white',   leggero: 'bg-green-100 text-green-600' },
  5: { dot: 'bg-blue-600',   pieno: 'bg-blue-600 text-white',    leggero: 'bg-blue-100 text-blue-600' },
};

const GIORNI_SETTIMANA = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

function buildWeeks(date: Date): (Date | null)[][] {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const days = eachDayOfInterval({ start, end });
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = [];
  // Italian week starts Monday; getDay() 0=Sun → Monday=0
  const firstDay = (getDay(start) + 6) % 7;
  for (let i = 0; i < firstDay; i++) week.push(null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

export default function CalendarioPage() {
  const camere = useCamere();
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[]>([]);
  const [mese, setMese] = useState(new Date());
  const [giornoSelezionato, setGiornoSelezionato] = useState<Date>(new Date());

  useEffect(() => {
    fetch('/api/prenotazioni').then((r) => r.json()).then(setPrenotazioni);
  }, []);

  const today = new Date();
  const settimane = buildWeeks(mese);

  function getDayInfo(day: Date, cameraId: number) {
    const pren = prenotazioni.find((p) => {
      if (p.camera_id !== cameraId || p.stato === 'cancellata') return false;
      return isWithinInterval(day, { start: parseISO(p.check_in), end: parseISO(p.check_out) });
    });
    if (!pren) return { occupied: false, isCheckIn: false, isCheckOut: false, pren: null };
    return {
      occupied: true,
      isCheckIn: isSameDay(day, parseISO(pren.check_in)),
      isCheckOut: isSameDay(day, parseISO(pren.check_out)),
      pren,
    };
  }

  const entrateDelMese = prenotazioni
    .filter((p) => {
      const d = parseISO(p.check_in);
      return (
        p.stato === 'confermata' &&
        p.fonte !== 'ical' &&
        d.getMonth() === mese.getMonth() &&
        d.getFullYear() === mese.getFullYear()
      );
    })
    .reduce((s, p) => s + p.importo_totale, 0);

  const prenDelGiorno = prenotazioni.filter((p) => {
    if (p.stato === 'cancellata') return false;
    return isWithinInterval(giornoSelezionato, {
      start: parseISO(p.check_in),
      end: parseISO(p.check_out),
    });
  });
  const camereDelGiorno = new Set(prenDelGiorno.map((p) => p.camera_id)).size;
  const ospititDelGiorno = prenDelGiorno.length;
  const valoreDelGiorno = prenDelGiorno
    .filter((p) => p.fonte !== 'ical')
    .reduce((s, p) => s + p.importo_totale, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Calendario</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setMese((m) => subMonths(m, 1))} className="p-1.5 rounded hover:bg-gray-200">
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-gray-700 capitalize w-36 text-center">
            {format(mese, 'MMMM yyyy', { locale: it })}
          </span>
          <button onClick={() => setMese((m) => addMonths(m, 1))} className="p-1.5 rounded hover:bg-gray-200">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 ml-auto">
          <span className="font-semibold text-blue-700 capitalize hidden sm:inline">
            {format(giornoSelezionato, 'EEEE d MMMM', { locale: it })}
          </span>
          {!isSameDay(giornoSelezionato, today) && (
            <button onClick={() => setGiornoSelezionato(today)} className="text-xs text-gray-400 hover:text-blue-600 hover:underline">
              Oggi
            </button>
          )}
          <span>Entrate: <strong className="text-green-700">€{entrateDelMese.toFixed(2)}</strong></span>
          <span><strong className="text-blue-700">{camereDelGiorno}</strong> <span className="text-gray-400">cam</span></span>
          <span><strong className="text-purple-700">{ospititDelGiorno}</strong> <span className="text-gray-400">osp</span></span>
        </div>
      </div>

      {/* Griglia mini-calendari */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:grid-cols-3">
        {camere.map((camera) => {
          const stile = STILE_CAMERA[camera.id] ?? STILE_CAMERA[1];
          return (
            <div key={camera.id} className="bg-white rounded-xl shadow-sm p-5">
              {/* Camera header */}
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-3 h-3 rounded-full ${stile.dot}`} />
                <span className="font-semibold text-gray-800">{camera.nome}</span>
                <span className="text-xs text-gray-400 ml-auto">€{camera.prezzo_notte.toFixed(2)}/n</span>
              </div>

              {/* Intestazione giorni settimana */}
              <div className="grid grid-cols-7 mb-1">
                {GIORNI_SETTIMANA.map((g, i) => (
                  <div key={i} className="flex items-center justify-center">
                    <span className="text-xs font-semibold text-gray-400 w-8 text-center py-1">
                      {g}
                    </span>
                  </div>
                ))}
              </div>

              {/* Settimane */}
              {settimane.map((settimana, si) => (
                <div key={si} className="grid grid-cols-7">
                  {settimana.map((day, di) => {
                    if (!day) return <div key={di} className="h-8" />;

                    const { occupied, isCheckIn, isCheckOut, pren } = getDayInfo(day, camera.id);
                    const isToday = isSameDay(day, today);

                    // Solo checkout (partenza): colore leggero
                    // Check-in o mid-stay: colore pieno
                    let circleClass = 'text-gray-700';
                    if (occupied && isCheckOut && !isCheckIn) {
                      circleClass = stile.leggero;
                    } else if (occupied) {
                      circleClass = stile.pieno;
                    }

                    const isSelected = isSameDay(day, giornoSelezionato);

                    return (
                      <div key={di} className="flex items-center justify-center py-0.5">
                        <div
                          title={pren ? `${pren.ospite_nome}` : ''}
                          onClick={() => setGiornoSelezionato(day)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors cursor-pointer
                            ${circleClass}
                            ${!occupied ? 'hover:bg-gray-100' : ''}
                            ${isToday ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                            ${isSelected ? 'outline outline-2 outline-offset-1 outline-gray-500' : ''}
                          `}
                        >
                          {format(day, 'd')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Lista prenotazioni del giorno selezionato */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h2 className="font-semibold text-gray-700 mb-3 capitalize">
          {format(giornoSelezionato, "EEEE d MMMM yyyy", { locale: it })}
        </h2>
        {(() => {
          const delGiorno = prenotazioni
            .filter((p) => {
              if (p.stato === 'cancellata') return false;
              const ci = parseISO(p.check_in);
              const co = parseISO(p.check_out);
              // ospite presente: check_in <= giorno < check_out
              return isWithinInterval(giornoSelezionato, { start: ci, end: co });
            })
            .sort((a, b) => a.camera_id - b.camera_id);

          if (delGiorno.length === 0)
            return <p className="text-gray-400 text-sm">Nessun ospite presente in questo giorno</p>;

          return (
            <div className="space-y-2">
              {delGiorno.map((p) => {
                const camera = camere.find((c) => c.id === p.camera_id);
                const stile = STILE_CAMERA[p.camera_id] ?? STILE_CAMERA[1];
                const ci = parseISO(p.check_in);
                const co = parseISO(p.check_out);
                const isCI = isSameDay(giornoSelezionato, ci);
                const isCO = isSameDay(giornoSelezionato, co);
                const notti = differenceInDays(co, ci);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stile.dot}`} />
                      <span className="font-medium">{p.ospite_nome}</span>
                      <span className="text-gray-400">{camera?.nome}</span>
                      {isCI && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">check-in</span>
                      )}
                      {isCO && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">check-out</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-gray-500">
                      <span className="text-xs">{fData(p.check_in)} → {fData(p.check_out)} ({notti}n)</span>
                      {p.fonte !== 'ical' && (
                        <span className="font-semibold text-gray-700">
                          €{p.importo_totale.toFixed(2)}
                          {p.tassa_soggiorno ? (
                            <span className="ml-1 text-xs font-normal text-amber-600">
                              +€{p.tassa_soggiorno.toFixed(2)} tds
                            </span>
                          ) : null}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
