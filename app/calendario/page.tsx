'use client';

import { useEffect, useState, Fragment, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
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
  addDays,
  getDay,
  differenceInDays,
} from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, RefreshCw } from 'lucide-react';
import PrenotazioneForm from '@/components/PrenotazioneForm';

// Colors matching room names: Rossa(1), Gialla(2), Verde(3), Bianca(4), Blue(5)
const STILE_CAMERA: Record<number, { dot: string; pieno: string; leggero: string }> = {
  1: { dot: 'bg-red-500',   pieno: 'bg-red-500 text-white',    leggero: 'bg-red-100 text-red-600' },    // Rossa
  2: { dot: 'bg-amber-400', pieno: 'bg-amber-400 text-white',  leggero: 'bg-amber-100 text-amber-600' }, // Gialla
  3: { dot: 'bg-green-500', pieno: 'bg-green-500 text-white',  leggero: 'bg-green-100 text-green-600' }, // Verde
  4: { dot: 'bg-gray-400',  pieno: 'bg-gray-400 text-white',   leggero: 'bg-gray-100 text-gray-600' },   // Bianca
  5: { dot: 'bg-blue-600',  pieno: 'bg-blue-600 text-white',   leggero: 'bg-blue-100 text-blue-600' },   // Blue
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
  const [meseStr, setMeseStr] = usePersistedState('cal-mese', format(new Date(), 'yyyy-MM-dd'));
  const [giornoStr, setGiornoStr] = usePersistedState('cal-giorno', format(new Date(), 'yyyy-MM-dd'));
  const mese = useMemo(() => parseISO(meseStr), [meseStr]);
  const giornoSelezionato = useMemo(() => parseISO(giornoStr), [giornoStr]);
  const setMese = (fn: Date | ((prev: Date) => Date)) => {
    setMeseStr(format(typeof fn === 'function' ? fn(mese) : fn, 'yyyy-MM-dd'));
  };
  const setGiornoSelezionato = (d: Date) => setGiornoStr(format(d, 'yyyy-MM-dd'));
  const [nuovaPrenotazione, setNuovaPrenotazione] = useState<{ cameraId: number; checkIn: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk]   = useState<boolean | null>(null);

  function caricaPrenotazioni() {
    fetch('/api/prenotazioni').then((r) => r.json()).then(setPrenotazioni);
  }

  useEffect(() => { caricaPrenotazioni(); }, []);

  async function syncIcal() {
    setSyncing(true);
    setSyncOk(null);
    try {
      const res = await fetch("/api/sync-gmail", { method: "POST" });
      const json = await res.json();
      setSyncOk(json.ok !== false);
      caricaPrenotazioni();
    } catch {
      setSyncOk(false);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncOk(null), 3000);
    }
  }

  async function creaPrenotazione(data: Partial<Prenotazione>) {
    await fetch('/api/prenotazioni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setNuovaPrenotazione(null);
    caricaPrenotazioni();
  }

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
        p.importo_totale > 0 &&
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
    .filter((p) => p.importo_totale > 0)
    .reduce((s, p) => s + p.importo_totale, 0);

  // JSX della lista prenotazioni del giorno (riusata in due posizioni)
  const listaGiornoJSX = (
    <>
      <h2 className="font-semibold text-gray-700 text-sm mb-2 capitalize">
        {format(giornoSelezionato, 'EEEE d MMMM yyyy', { locale: it })}
      </h2>
      {(() => {
        const delGiorno = prenotazioni
          .filter((p) => {
            if (p.stato === 'cancellata') return false;
            return isWithinInterval(giornoSelezionato, {
              start: parseISO(p.check_in),
              end: parseISO(p.check_out),
            });
          })
          .sort((a, b) => a.camera_id - b.camera_id);

        if (delGiorno.length === 0)
          return <p className="text-gray-400 text-xs">Nessun ospite presente in questo giorno</p>;

        return (
          <div className="space-y-1">
            {delGiorno.map((p) => {
              const cam = camere.find((c) => c.id === p.camera_id);
              const st  = STILE_CAMERA[p.camera_id] ?? STILE_CAMERA[1];
              const ci  = parseISO(p.check_in);
              const co  = parseISO(p.check_out);
              const isCI = isSameDay(giornoSelezionato, ci);
              const isCO = isSameDay(giornoSelezionato, co);
              const notti = differenceInDays(co, ci);
              return (
                <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium truncate">{p.ospite_nome}</span>
                        <span className="text-gray-400 flex-shrink-0">{cam?.nome}</span>
                        {isCI && <span className="text-[10px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium flex-shrink-0">CI</span>}
                        {isCO && <span className="text-[10px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium flex-shrink-0">CO</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        <span>{fData(p.check_in)}</span>
                        <span className="mx-0.5">→</span>
                        <span>{fData(p.check_out)}</span>
                        <span className="ml-1">({notti}n)</span>
                      </div>
                    </div>
                  </div>
                  {p.importo_totale > 0 && (
                    <span className="font-semibold text-gray-700 flex-shrink-0">
                      €{p.importo_totale.toFixed(0)}
                      {p.tassa_soggiorno ? (
                        <span className="ml-0.5 text-[10px] font-normal text-amber-600">
                          +€{p.tassa_soggiorno.toFixed(0)}tds
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-gray-800">Calendario</h1>
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
        <button
          onClick={syncIcal}
          disabled={syncing}
          className={`flex items-center gap-1.5 border px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            syncOk === true  ? 'border-green-300 bg-green-50 text-green-700' :
            syncOk === false ? 'border-red-300 bg-red-50 text-red-700' :
            'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          Sync Gmail
        </button>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:grid-cols-3">
        {camere.map((camera, idx) => {
          const stile = STILE_CAMERA[camera.id] ?? STILE_CAMERA[1];
          return (
            <Fragment key={camera.id}>
            <div className="bg-white rounded-xl shadow-sm px-2 pt-2 pb-1">
              {/* Camera header */}
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${stile.dot}`} />
                <span className="font-semibold text-gray-800 text-xs">{camera.nome}</span>
                <span className="text-[10px] text-gray-400 ml-auto">€{camera.prezzo_notte.toFixed(2)}/n</span>
              </div>

              {/* Intestazione giorni settimana */}
              <div className="grid grid-cols-7">
                {GIORNI_SETTIMANA.map((g, i) => (
                  <div key={i} className="flex items-center justify-center">
                    <span className="text-[9px] font-semibold text-gray-400 text-center">
                      {g}
                    </span>
                  </div>
                ))}
              </div>

              {/* Settimane */}
              {settimane.map((settimana, si) => {
                // ── Calcola le pill per questa settimana ──
                const pills: Array<{
                  pren: Prenotazione;
                  colStart: number; // 1-based CSS grid
                  colSpan: number;
                  isStart: boolean; // check-in è in questa settimana
                  isEnd: boolean;   // check-out è in questa settimana
                }> = [];
                const visti = new Set<string>();

                settimana.forEach(day => {
                  if (!day) return;
                  prenotazioni.forEach(p => {
                    if (p.camera_id !== camera.id || p.stato === 'cancellata' || visti.has(p.id)) return;
                    const ci = parseISO(p.check_in);
                    const co = parseISO(p.check_out);
                    if (!isWithinInterval(day, { start: ci, end: co })) return;
                    visti.add(p.id);

                    let first = -1, last = -1;
                    settimana.forEach((d, i) => {
                      if (!d) return;
                      if (isWithinInterval(d, { start: ci, end: co })) {
                        if (first === -1) first = i;
                        last = i;
                      }
                    });
                    if (first === -1) return;

                    pills.push({
                      pren: p,
                      colStart: first + 1,
                      colSpan: last - first + 1,
                      isStart: isSameDay(settimana[first]!, ci),
                      isEnd:   isSameDay(settimana[last]!,  co),
                    });
                  });
                });

                return (
                  <div key={si}>
                    {/* Riga pillole prenotazione */}
                    <div className="grid grid-cols-7 h-3 pointer-events-none" aria-hidden="true">
                      {pills.map(({ pren, colStart, colSpan, isStart, isEnd }) => (
                        <div
                          key={pren.id}
                          title={pren.ospite_nome}
                          className={`h-2.5 self-center overflow-hidden flex items-center text-[7px] font-semibold text-white
                            ${stile.pieno}
                            ${isStart && isEnd  ? 'mx-0.5 rounded-full' : ''}
                            ${isStart && !isEnd ? 'ml-0.5 rounded-l-full' : ''}
                            ${!isStart && isEnd ? 'mr-0.5 rounded-r-full' : ''}
                          `}
                          style={{ gridColumnStart: colStart, gridColumnEnd: colStart + colSpan }}
                        >
                          {isStart && (
                            <span className="ml-1 truncate leading-none">
                              {pren.ospite_nome.split(' ')[0]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Riga numeri giorni */}
                    <div className="grid grid-cols-7">
                      {settimana.map((day, di) => {
                        if (!day) return <div key={di} className="h-6" />;
                        const { pren } = getDayInfo(day, camera.id);
                        const isToday    = isSameDay(day, today);
                        const isSelected = isSameDay(day, giornoSelezionato);
                        return (
                          <div key={di} className="flex items-center justify-center">
                            <div
                              title={pren ? pren.ospite_nome : 'Doppio click per nuova prenotazione'}
                              onClick={() => setGiornoSelezionato(day)}
                              onDoubleClick={() => setNuovaPrenotazione({
                                cameraId: camera.id,
                                checkIn: format(day, 'yyyy-MM-dd'),
                              })}
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium transition-colors cursor-pointer
                                text-gray-700 hover:bg-black/5
                                ${isToday    ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                                ${isSelected ? 'outline outline-2 outline-offset-1 outline-gray-500' : ''}
                              `}
                            >
                              {format(day, 'd')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Lista del giorno: dopo cam 4 e 5 → occupa la cella sotto cam 3 */}
            {idx === 4 && (
              <div className="hidden md:block bg-white rounded-xl shadow-sm p-4 overflow-y-auto max-h-72">
                {listaGiornoJSX}
              </div>
            )}
            </Fragment>
          );
        })}
      </div>

      {/* Lista prenotazioni del giorno — solo mobile */}
      <div className="md:hidden bg-white rounded-lg shadow-sm p-5">
        {listaGiornoJSX}
      </div>

      {/* Modale nuova prenotazione */}
      {nuovaPrenotazione && (() => {
        const camera = camere.find((c) => c.id === nuovaPrenotazione.cameraId);
        const checkOut = format(addDays(parseISO(nuovaPrenotazione.checkIn), 1), 'yyyy-MM-dd');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setNuovaPrenotazione(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <div>
                  <h2 className="font-semibold text-gray-800">Nuova prenotazione</h2>
                  {camera && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {camera.nome} — check-in {fData(nuovaPrenotazione.checkIn)}
                    </p>
                  )}
                </div>
                <button onClick={() => setNuovaPrenotazione(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
              <div className="px-6 py-4">
                <PrenotazioneForm
                  iniziale={{
                    camera_id: nuovaPrenotazione.cameraId,
                    check_in: nuovaPrenotazione.checkIn,
                    check_out: checkOut,
                  }}
                  onSalva={creaPrenotazione}
                  onAnnulla={() => setNuovaPrenotazione(null)}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
