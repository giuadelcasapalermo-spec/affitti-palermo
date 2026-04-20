'use client';

import { useEffect, useState, useCallback } from 'react';
import { Prenotazione, Uscita, Entrata } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { isWithinInterval, parseISO, differenceInDays, format, startOfMonth, endOfMonth } from 'date-fns';
import { fData } from '@/lib/utils';
import { BedDouble, Euro, Users, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

const COLORI_CAMERA: Record<number, { bg: string; border: string; testo: string; bar: string }> = {
  1: { bg: 'bg-red-100',   border: 'border-red-300',   testo: 'text-red-800',   bar: 'bg-red-500' },   // Rossa
  2: { bg: 'bg-amber-100', border: 'border-amber-300', testo: 'text-amber-800', bar: 'bg-amber-400' }, // Gialla
  3: { bg: 'bg-green-100', border: 'border-green-300', testo: 'text-green-800', bar: 'bg-green-500' }, // Verde
  4: { bg: 'bg-gray-100',  border: 'border-gray-300',  testo: 'text-gray-800',  bar: 'bg-gray-400' },  // Bianca
  5: { bg: 'bg-blue-100',  border: 'border-blue-300',  testo: 'text-blue-800',  bar: 'bg-blue-600' },  // Blue
};

function isCameraOccupata(prenotazioni: Prenotazione[], cameraId: number): Prenotazione | null {
  const oggi = new Date();
  return (
    prenotazioni.find(
      (p) =>
        p.camera_id === cameraId &&
        p.stato === 'confermata' &&
        isWithinInterval(oggi, {
          start: parseISO(p.check_in),
          end: parseISO(p.check_out),
        })
    ) ?? null
  );
}

function statoColore(stato: Prenotazione['stato']) {
  if (stato === 'confermata') return 'bg-green-100 text-green-800';
  if (stato === 'pending') return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function statoLabel(stato: Prenotazione['stato']) {
  if (stato === 'confermata') return 'Confermata';
  if (stato === 'pending') return 'In attesa';
  return 'Cancellata';
}

const oggi = new Date();
const DEFAULT_DAL = format(startOfMonth(oggi), 'yyyy-MM-dd');
const DEFAULT_AL = format(endOfMonth(oggi), 'yyyy-MM-dd');

export default function Dashboard() {
  const camere = useCamere();
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[]>([]);
  const [uscite, setUscite] = useState<Uscita[]>([]);
  const [entrate, setEntrate] = useState<Entrata[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filtroDal, setFiltroDal] = useState(DEFAULT_DAL);
  const [filtroAl, setFiltroAl] = useState(DEFAULT_AL);
  const [filtroCamera, setFiltroCamera] = useState<number | 'tutte'>('tutte');

  const carica = useCallback(() => {
    fetch('/api/prenotazioni')
      .then((r) => r.json())
      .then((data) => {
        setPrenotazioni(data);
        setLoading(false);
      });
    fetch('/api/uscite')
      .then((r) => r.json())
      .then(setUscite);
    fetch('/api/entrate')
      .then((r) => r.json())
      .then(setEntrate);
  }, []);

  const syncIcal = useCallback(async () => {
    setSyncing(true);
    await fetch('/api/sync', { method: 'POST' });
    carica();
    setSyncing(false);
  }, [carica]);

  useEffect(() => {
    carica();
    const timer = setInterval(syncIcal, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [carica, syncIcal]);

  const filtroAttivo = filtroDal !== DEFAULT_DAL || filtroAl !== DEFAULT_AL || filtroCamera !== 'tutte';

  // Prenotazioni nel periodo (si sovrappongono all'intervallo)
  const prenNelPeriodo = prenotazioni.filter(
    (p) =>
      p.stato === 'confermata' &&
      p.check_in <= filtroAl &&
      p.check_out >= filtroDal &&
      (filtroCamera === 'tutte' || p.camera_id === filtroCamera)
  );

  // KPI calcolati sul periodo selezionato
  const usciteDelPeriodo = uscite
    .filter((u) => u.data >= filtroDal && u.data <= filtroAl)
    .reduce((s, u) => s + u.importo, 0);

  const entrateEffettive = entrate
    .filter((e) => e.data >= filtroDal && e.data <= filtroAl)
    .reduce((s, e) => s + e.importo, 0);

  const entrateDelPeriodo = prenNelPeriodo
    .filter((p) => p.importo_totale > 0 && p.check_in >= filtroDal && p.check_in <= filtroAl)
    .reduce((sum, p) => sum + p.importo_totale, 0);

  const totalOspiti = prenNelPeriodo.filter(
    (p) => p.check_in >= filtroDal && p.check_in <= filtroAl
  ).length;

  // Camere impegnate nel periodo
  const camereImpegnate = camere.filter((c) =>
    prenNelPeriodo.some((p) => p.camera_id === c.id)
  );

  const statsCamera = camere.map((camera) => {
    const pren = prenNelPeriodo.filter((p) => p.camera_id === camera.id);
    const notti = pren.reduce((s, p) => s + differenceInDays(parseISO(p.check_out), parseISO(p.check_in)), 0);
    const ricavo = pren.filter((p) => p.importo_totale > 0).reduce((s, p) => s + p.importo_totale, 0);
    return { camera, notti, ricavo };
  });
  const maxNotti = Math.max(1, ...statsCamera.map((s) => s.notti));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Caricamento...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={syncIcal}
            disabled={syncing}
            title="Sincronizza Booking.com"
            className="flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-2 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sync...' : 'Sync iCal'}
          </button>
          <Link
            href="/prenotazioni?nuova=1"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            + Nuova
          </Link>
        </div>
      </div>

      {/* Filtro periodo + camera */}
      <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium text-gray-600">Periodo:</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filtroDal}
            onChange={(e) => setFiltroDal(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={filtroAl}
            onChange={(e) => setFiltroAl(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <span className="text-sm font-medium text-gray-600">Camera:</span>
        <select
          value={filtroCamera}
          onChange={(e) => setFiltroCamera(e.target.value === 'tutte' ? 'tutte' : Number(e.target.value))}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="tutte">Tutte</option>
          {camere.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
        {filtroAttivo && (
          <button
            onClick={() => { setFiltroDal(DEFAULT_DAL); setFiltroAl(DEFAULT_AL); setFiltroCamera('tutte'); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* KPI mobile compatto */}
      {(() => { const saldo = entrateEffettive - usciteDelPeriodo; return (
      <div className="sm:hidden bg-white rounded-lg shadow-sm px-4 py-3 grid grid-cols-3 gap-y-3 divide-x divide-gray-100">
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Camere</div>
          <div className="text-base font-bold text-gray-800">{camereImpegnate.length}/{filtroCamera === 'tutte' ? camere.length : 1}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Previsionali</div>
          <div className="text-base font-bold text-gray-800">€{entrateDelPeriodo.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Ospiti</div>
          <div className="text-base font-bold text-gray-800">{totalOspiti}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Uscite</div>
          <div className="text-base font-bold text-red-600">-€{usciteDelPeriodo.toFixed(0)}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Entrate</div>
          <div className="text-base font-bold text-green-700">+€{entrateEffettive.toFixed(0)}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Saldo</div>
          <div className={`text-base font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>€{saldo.toFixed(0)}</div>
        </div>
      </div>
      ); })()}

      {/* KPI cards desktop */}
      <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-blue-100 rounded-full p-2"><BedDouble size={20} className="text-blue-600" /></div>
          <div>
            <div className="text-sm text-gray-500">Camere nel periodo</div>
            <div className="text-lg font-bold text-gray-800">{camereImpegnate.length} / {filtroCamera === 'tutte' ? camere.length : 1}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2"><Euro size={20} className="text-green-600" /></div>
          <div>
            <div className="text-sm text-gray-500">Prenotazioni (previsionali)</div>
            <div className="text-lg font-bold text-gray-800">€{entrateDelPeriodo.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-purple-100 rounded-full p-2"><Users size={20} className="text-purple-600" /></div>
          <div>
            <div className="text-sm text-gray-500">Ospiti nel periodo</div>
            <div className="text-lg font-bold text-gray-800">{totalOspiti}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-red-100 rounded-full p-2"><TrendingDown size={20} className="text-red-600" /></div>
          <div>
            <div className="text-sm text-gray-500">Uscite del periodo</div>
            <div className="text-lg font-bold text-red-600">-€{usciteDelPeriodo.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2"><TrendingUp size={20} className="text-green-600" /></div>
          <div>
            <div className="text-sm text-gray-500">Entrate effettive</div>
            <div className="text-lg font-bold text-green-700">+€{entrateEffettive.toFixed(2)}</div>
          </div>
        </div>
        <div className={`rounded-lg shadow-sm p-4 flex items-center gap-3 ${entrateEffettive - usciteDelPeriodo >= 0 ? 'bg-white' : 'bg-red-50'}`}>
          <div className={`rounded-full p-2 ${entrateEffettive - usciteDelPeriodo >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
            <TrendingUp size={20} className={entrateEffettive - usciteDelPeriodo >= 0 ? 'text-green-600' : 'text-red-600'} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Saldo effettivo</div>
            <div className={`text-lg font-bold ${entrateEffettive - usciteDelPeriodo >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              €{(entrateEffettive - usciteDelPeriodo).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Stato camere nel periodo */}
      {(() => {
        const COLORI: Record<number, { bg: string; border: string; testo: string }> = {
          1: { bg: 'bg-sky-100',    border: 'border-sky-300',    testo: 'text-sky-800' },
          2: { bg: 'bg-amber-100',  border: 'border-amber-300',  testo: 'text-amber-800' },
          3: { bg: 'bg-red-100',    border: 'border-red-300',    testo: 'text-red-800' },
          4: { bg: 'bg-green-100',  border: 'border-green-300',  testo: 'text-green-800' },
          5: { bg: 'bg-blue-100',   border: 'border-blue-300',   testo: 'text-blue-800' },
        };
        const camFiltrate = camere.filter((c) => filtroCamera === 'tutte' || c.id === filtroCamera);
        return (
          <div className="bg-white rounded-lg shadow-sm p-3 sm:p-5">
            <h2 className="font-semibold text-gray-700 mb-3 sm:mb-4 text-sm sm:text-base">Camere nel periodo</h2>
            <div className={`grid gap-1.5 sm:gap-3 ${camFiltrate.length === 1 ? 'grid-cols-1' : 'grid-cols-5'}`}>
              {camFiltrate.map((camera) => {
                const prenotazioniCamera = prenNelPeriodo.filter((p) => p.camera_id === camera.id);
                const impegnata = prenotazioniCamera.length > 0;
                const nottiTotali = prenotazioniCamera.reduce(
                  (s, p) => s + differenceInDays(parseISO(p.check_out), parseISO(p.check_in)), 0
                );
                const stimaCamera = prenotazioniCamera
                  .filter((p) => p.importo_totale > 0)
                  .reduce((s, p) => s + p.importo_totale, 0);
                const occupazioneOggi = isCameraOccupata(prenotazioni, camera.id);
                const col = COLORI_CAMERA[camera.id] ?? COLORI_CAMERA[1];
                return (
                  <div key={camera.id} className={`rounded-lg p-1.5 sm:p-3 text-center border ${col.bg} ${col.border}`}>
                    <div className={`font-bold text-[10px] sm:text-sm ${col.testo}`}>{camera.nome}</div>
                    <div className={`text-[9px] sm:text-xs font-medium mt-0.5 ${impegnata ? 'text-red-700' : 'text-green-700'}`}>
                      {impegnata ? `${prenotazioniCamera.length} pren.` : 'Libera'}
                    </div>
                    {impegnata && <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5">{nottiTotali}n</div>}
                    {stimaCamera > 0 && <div className="text-[9px] sm:text-xs font-semibold text-green-700 mt-0.5">€{stimaCamera.toFixed(0)}</div>}
                    {occupazioneOggi && (
                      <div className={`text-[9px] sm:text-xs mt-0.5 truncate font-medium ${col.testo}`}>
                        {occupazioneOggi.ospite_nome.split(' ')[0]}
                      </div>
                    )}
                    <div className="text-[9px] sm:text-xs text-gray-400 mt-0.5">€{camera.prezzo_notte.toFixed(0)}/n</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Andamento prenotazioni per stanza — solo desktop */}
      {(() => {
        const start  = new Date(filtroDal + 'T00:00:00Z');
        const nDays  = differenceInDays(new Date(filtroAl + 'T00:00:00Z'), start) + 1;
        const days   = Array.from({ length: nDays }, (_, i) => {
          const d = new Date(start);
          d.setUTCDate(d.getUTCDate() + i);
          return d.toISOString().split('T')[0];
        });
        const camFiltrate = camere.filter(c => filtroCamera === 'tutte' || c.id === filtroCamera);
        const getPren = (cameraId: number, day: string) =>
          prenotazioni.find(p =>
            p.camera_id === cameraId &&
            p.stato !== 'cancellata' &&
            p.check_in <= day &&
            p.check_out > day
          ) ?? null;

        return (
          <div className="hidden md:block bg-white rounded-lg shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Andamento prenotazioni per stanza</h2>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 'max-content' }}>
                {/* Header: numeri giorno */}
                <div className="flex mb-1" style={{ paddingLeft: '92px' }}>
                  {days.map(day => {
                    const dow = new Date(day + 'T00:00:00Z').getUTCDay();
                    const isWe = dow === 0 || dow === 6;
                    return (
                      <div key={day} className={`text-center text-[10px] leading-none select-none ${isWe ? 'text-blue-500 font-semibold' : 'text-gray-400'}`} style={{ width: '26px' }}>
                        {parseInt(day.slice(8))}
                      </div>
                    );
                  })}
                </div>

                {/* Riga per stanza */}
                {camFiltrate.map(camera => {
                  const col = COLORI_CAMERA[camera.id] ?? COLORI_CAMERA[1];
                  return (
                    <div key={camera.id} className="flex items-center mb-1">
                      <div className={`text-xs font-semibold flex-shrink-0 ${col.testo}`} style={{ width: '92px' }}>
                        {camera.nome}
                      </div>
                      <div className="flex gap-px">
                        {days.map((day, idx) => {
                          const pren     = getPren(camera.id, day);
                          const prevPren = idx > 0 ? getPren(camera.id, days[idx - 1]) : null;
                          const isStart  = pren && (!prevPren || prevPren.id !== pren.id);
                          const isEnd    = pren && (idx === days.length - 1 || !getPren(camera.id, days[idx + 1]));
                          return (
                            <div
                              key={day}
                              title={pren ? `${pren.ospite_nome}  ${pren.check_in} → ${pren.check_out}` : ''}
                              className={`relative flex items-center overflow-hidden ${
                                pren
                                  ? `${col.bar} ${isStart && isEnd ? 'rounded' : isStart ? 'rounded-l' : isEnd ? 'rounded-r' : ''}`
                                  : 'bg-gray-100 rounded-sm'
                              }`}
                              style={{ width: '26px', height: '22px' }}
                            >
                              {isStart && (
                                <span className="text-white text-[8px] font-bold pl-1 truncate leading-none select-none">
                                  {pren!.ospite_nome.split(' ')[0]}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
