'use client';

import { useEffect, useState, useCallback } from 'react';
import { Prenotazione, Uscita, Entrata } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { isWithinInterval, parseISO, differenceInDays, format, startOfMonth, endOfMonth } from 'date-fns';
import { fData } from '@/lib/utils';
import { BedDouble, Euro, CalendarCheck, Users, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

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
    .filter((p) => p.fonte !== 'ical' && p.check_in >= filtroDal && p.check_in <= filtroAl)
    .reduce((sum, p) => sum + p.importo_totale, 0);

  const totalOspiti = prenNelPeriodo.filter(
    (p) => p.check_in >= filtroDal && p.check_in <= filtroAl
  ).length;

  // Camere impegnate nel periodo
  const camereImpegnate = camere.filter((c) =>
    prenNelPeriodo.some((p) => p.camera_id === c.id)
  );

  const arriviNelPeriodo = prenNelPeriodo
    .filter((p) => p.check_in >= filtroDal && p.check_in <= filtroAl)
    .sort((a, b) => parseISO(a.check_in).getTime() - parseISO(b.check_in).getTime())
    .slice(0, 10);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Caricamento...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
            + Nuova prenotazione
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

      {/* KPI cards */}
      <div className="grid grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-blue-100 rounded-full p-2">
            <BedDouble size={20} className="text-blue-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Camere nel periodo</div>
            <div className="text-lg font-bold text-gray-800">
              {camereImpegnate.length} / {filtroCamera === 'tutte' ? camere.length : 1}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2">
            <Euro size={20} className="text-green-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Prenotazioni (previsionali)</div>
            <div className="text-lg font-bold text-gray-800">€{entrateDelPeriodo.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-purple-100 rounded-full p-2">
            <Users size={20} className="text-purple-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Ospiti nel periodo</div>
            <div className="text-lg font-bold text-gray-800">{totalOspiti}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-red-100 rounded-full p-2">
            <TrendingDown size={20} className="text-red-600" />
          </div>
          <div>
            <div className="text-sm text-gray-500">Uscite del periodo</div>
            <div className="text-lg font-bold text-red-600">-€{usciteDelPeriodo.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2">
            <TrendingUp size={20} className="text-green-600" />
          </div>
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
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h2 className="font-semibold text-gray-700 mb-4">Camere nel periodo</h2>
        <div className="grid grid-cols-5 gap-3">
          {camere
            .filter((c) => filtroCamera === 'tutte' || c.id === filtroCamera)
            .map((camera) => {
              const prenotazioniCamera = prenNelPeriodo.filter((p) => p.camera_id === camera.id);
              const impegnata = prenotazioniCamera.length > 0;
              const nottiTotali = prenotazioniCamera.reduce(
                (s, p) => s + differenceInDays(parseISO(p.check_out), parseISO(p.check_in)),
                0
              );
              const stimaCamera = prenotazioniCamera
                .filter((p) => p.fonte !== 'ical')
                .reduce((s, p) => s + p.importo_totale, 0);
              const occupazioneOggi = isCameraOccupata(prenotazioni, camera.id);
              return (
                <div
                  key={camera.id}
                  className={`rounded-lg p-3 text-center border-2 ${
                    impegnata ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'
                  }`}
                >
                  <div className="font-semibold text-sm text-gray-700">{camera.nome}</div>
                  <div className={`text-xs font-medium mt-1 ${impegnata ? 'text-red-700' : 'text-green-700'}`}>
                    {impegnata ? `${prenotazioniCamera.length} prenotaz.` : 'Libera'}
                  </div>
                  {impegnata && (
                    <div className="text-xs text-gray-500 mt-1">{nottiTotali} notti</div>
                  )}
                  {stimaCamera > 0 && (
                    <div className="text-xs font-semibold text-green-700 mt-1">€{stimaCamera.toFixed(2)}</div>
                  )}
                  {occupazioneOggi && (
                    <div className="text-xs text-blue-600 mt-0.5 truncate font-medium">
                      ● {occupazioneOggi.ospite_nome.split(' ')[0]} oggi
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">€{camera.prezzo_notte.toFixed(2)}/n</div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Arrivi nel periodo */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck size={18} className="text-blue-600" />
          <h2 className="font-semibold text-gray-700">Arrivi nel periodo</h2>
        </div>
        {arriviNelPeriodo.length === 0 ? (
          <p className="text-gray-400 text-sm">Nessuna prenotazione nel periodo selezionato</p>
        ) : (
          <div className="space-y-2">
            {arriviNelPeriodo.map((p) => {
              const notti = differenceInDays(parseISO(p.check_out), parseISO(p.check_in));
              const camera = camere.find((c) => c.id === p.camera_id);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 border-b last:border-b-0"
                >
                  <div>
                    <span className="font-medium text-sm text-gray-800">{p.ospite_nome}</span>
                    <span className="text-xs text-gray-500 ml-2">{camera?.nome}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {fData(p.check_in)} → {fData(p.check_out)} ({notti}n)
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statoColore(p.stato)}`}>
                      {statoLabel(p.stato)}
                    </span>
                    {p.fonte !== 'ical' && (
                      <span className="text-sm font-semibold text-gray-700">
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
        )}
      </div>
    </div>
  );
}
