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
  isBefore,
  addMonths,
  subMonths,
  addDays,
  subDays,
  getDay,
  differenceInDays,
} from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, RefreshCw, LayoutGrid, CalendarDays } from 'lucide-react';
import { getCameraStyle } from '@/lib/camera-colors';
import PrenotazioneForm from '@/components/PrenotazioneForm';
import { useSoloCalendario } from '@/hooks/useSoloCalendario';


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
  const soloCalendario = useSoloCalendario();
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[]>([]);
  const [meseStr, setMeseStr] = usePersistedState('cal-mese', format(new Date(), 'yyyy-MM-dd'));
  const [giornoStr, setGiornoStr] = usePersistedState('cal-giorno', format(new Date(), 'yyyy-MM-dd'));
  const mese = useMemo(() => parseISO(meseStr), [meseStr]);
  const giornoSelezionato = useMemo(() => parseISO(giornoStr), [giornoStr]);
  const setMese = (fn: Date | ((prev: Date) => Date)) => {
    setMeseStr(format(typeof fn === 'function' ? fn(mese) : fn, 'yyyy-MM-dd'));
  };
  const setGiornoSelezionato = (d: Date) => setGiornoStr(format(d, 'yyyy-MM-dd'));
  const navigaGiorno = (delta: 1 | -1) => {
    const nuovo = delta === 1 ? addDays(giornoSelezionato, 1) : subDays(giornoSelezionato, 1);
    setGiornoSelezionato(nuovo);
    if (nuovo.getMonth() !== mese.getMonth() || nuovo.getFullYear() !== mese.getFullYear()) {
      setMese(nuovo);
    }
  };
  const [nuovaPrenotazione, setNuovaPrenotazione] = useState<{ cameraId: number; checkIn: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk]   = useState<boolean | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [vistaCompatta, setVistaCompatta] = usePersistedState<boolean>('cal-compatta', false, { storage: 'local' });
  const vistaEffettiva = soloCalendario ? true : vistaCompatta;

  function caricaPrenotazioni() {
    fetch('/api/prenotazioni').then((r) => r.json()).then(setPrenotazioni);
  }

  useEffect(() => { caricaPrenotazioni(); }, []);

  async function syncIcal() {
    setSyncing(true);
    setSyncOk(null);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      const ok = json.ok !== false;
      setSyncOk(ok);
      const totIcal = (json.risultati ?? []).reduce((s: number, r: { aggiunte: number }) => s + r.aggiunte, 0);
      const arricchite = json.prenotazioniArricchite ?? 0;
      let msg = `iCal: +${totIcal}`;
      if (!json.sheetsConfigurato) msg += ' · Sheet: non configurato';
      else if (json.sheetsErrore) msg += ` · Sheet errore: ${json.sheetsErrore}`;
      else msg += ` · Sheet: ${arricchite} aggiornate`;
      setSyncMsg(msg);
      caricaPrenotazioni();
    } catch {
      setSyncOk(false);
      setSyncMsg('Errore di rete');
    } finally {
      setSyncing(false);
      setTimeout(() => { setSyncOk(null); setSyncMsg(null); }, 6000);
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

  // Convenzione hotel: il giorno di check-out NON è occupato (ci <= day < co)
  function isNottePren(day: Date, p: Prenotazione): boolean {
    const ci = parseISO(p.check_in);
    const co = parseISO(p.check_out);
    return !isBefore(day, ci) && isBefore(day, co);
  }

  // Cambio lenzuola/asciugamani ogni 3 notti trascorse (k), evitando che l'ultimo intervallo
  // prima del check-out resti di 1 sola notte: se il soggiorno (N notti) è N%3===1, l'ultimo
  // cambio "naturale" (a k = N-1) viene anticipato a k = N-2, così l'ultimo intervallo è di 2 notti.
  // Es. 4 notti → cambio a k=2 (invece di k=3); 7 notti → cambio a k=3 e k=5 (invece di k=3 e k=6).
  function isGiornoCambio(k: number, nottiTotali: number): boolean {
    if (k <= 0) return false;
    if (nottiTotali % 3 === 1) {
      if (k === nottiTotali - 1) return false; // rimpiazzato da k = nottiTotali - 2
      if (k === nottiTotali - 2) return true;
    }
    return k % 3 === 0;
  }

  function getDayInfo(day: Date, cameraId: number) {
    const pren = prenotazioni.find((p) => {
      if (p.camera_id !== cameraId || p.stato === 'cancellata') return false;
      return isNottePren(day, p);
    });
    if (!pren) return { occupied: false, isCheckIn: false, isCheckOut: false, pren: null };
    return {
      occupied: true,
      isCheckIn: isSameDay(day, parseISO(pren.check_in)),
      isCheckOut: false,
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
    return isNottePren(giornoSelezionato, p); // esclude il giorno di check-out dal conteggio
  });
  const camereDelGiorno = new Set(prenDelGiorno.map((p) => p.camera_id)).size;
  const ospititDelGiorno = prenDelGiorno.length;
  const valoreDelGiorno = prenDelGiorno
    .filter((p) => p.importo_totale > 0)
    .reduce((s, p) => s + p.importo_totale, 0);

  // Riepilogo pulizie del giorno selezionato: check-out (ospiti che lasciano la stanza)
  // e cambio stanza (soggiorni lunghi, biancheria/pulizia ogni 3 notti trascorse)
  const pulizieCheckout = prenotazioni
    .filter((p) => p.stato !== 'cancellata' && isSameDay(parseISO(p.check_out), giornoSelezionato))
    .sort((a, b) => a.camera_id - b.camera_id);

  const pulizieCambio = prenotazioni
    .filter((p) => {
      if (p.stato === 'cancellata' || !isNottePren(giornoSelezionato, p)) return false;
      const nottiTrascorse = differenceInDays(giornoSelezionato, parseISO(p.check_in));
      const nottiTotali = differenceInDays(parseISO(p.check_out), parseISO(p.check_in));
      return isGiornoCambio(nottiTrascorse, nottiTotali);
    })
    .sort((a, b) => a.camera_id - b.camera_id);

  // Filtro giorno versione compatta (senza mese/anno) — in una riga propria sotto il filtro mese su mobile
  const giornoNavCompactJSX = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <button onClick={() => navigaGiorno(-1)} className="p-1 rounded hover:bg-gray-200">
          <ChevronLeft size={15} />
        </button>
        <h2 className="font-semibold text-gray-700 text-sm capitalize text-center min-w-[70px]">
          {format(giornoSelezionato, 'EEE d', { locale: it })}
        </h2>
        <button onClick={() => navigaGiorno(1)} className="p-1 rounded hover:bg-gray-200">
          <ChevronRight size={15} />
        </button>
      </div>
      {!isSameDay(giornoSelezionato, today) && (
        <button onClick={() => setGiornoSelezionato(today)} className="text-xs text-gray-400 hover:text-blue-600 hover:underline">
          Oggi
        </button>
      )}
    </div>
  );

  // Filtro giorno versione estesa (con mese/anno) — accanto al filtro mese su desktop,
  // ripetuto sopra i dettagli dei clienti presenti su mobile
  const giornoNavJSX = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <button onClick={() => navigaGiorno(-1)} className="p-1 rounded hover:bg-gray-200">
          <ChevronLeft size={15} />
        </button>
        <h2 className="font-semibold text-gray-700 text-sm capitalize text-center min-w-[180px]">
          {format(giornoSelezionato, 'EEEE d MMMM yyyy', { locale: it })}
        </h2>
        <button onClick={() => navigaGiorno(1)} className="p-1 rounded hover:bg-gray-200">
          <ChevronRight size={15} />
        </button>
      </div>
      {!isSameDay(giornoSelezionato, today) && (
        <button onClick={() => setGiornoSelezionato(today)} className="text-xs text-gray-400 hover:text-blue-600 hover:underline">
          Oggi
        </button>
      )}
    </div>
  );

  // JSX della lista prenotazioni del giorno (riusata in due posizioni) — su mobile ripete il filtro
  // giorno esteso sopra i dettagli (su desktop è già mostrato accanto al filtro mese)
  const listaGiornoJSX = (
    <>
      <div className="sm:hidden flex mb-2">
        {giornoNavJSX}
      </div>
      {(() => {
        const tutti = prenotazioni
          .filter((p) => {
            if (p.stato === 'cancellata') return false;
            return isWithinInterval(giornoSelezionato, {
              start: parseISO(p.check_in),
              end: parseISO(p.check_out),
            });
          })
          .sort((a, b) => a.camera_id - b.camera_id);

        if (tutti.length === 0)
          return <p className="text-gray-400 text-xs">Nessun ospite presente in questo giorno</p>;

        const partenze = tutti.filter(p => isSameDay(giornoSelezionato, parseISO(p.check_out)));
        const arrivi   = tutti.filter(p => isSameDay(giornoSelezionato, parseISO(p.check_in)));
        const presenti = tutti.filter(p =>
          !isSameDay(giornoSelezionato, parseISO(p.check_out)) &&
          !isSameDay(giornoSelezionato, parseISO(p.check_in))
        );

        const renderRow = (p: Prenotazione) => {
          const cam  = camere.find((c) => c.id === p.camera_id);
          const st   = getCameraStyle(p.camera_id, cam?.colore);
          const ci   = parseISO(p.check_in);
          const co   = parseISO(p.check_out);
          const isCI = isSameDay(giornoSelezionato, ci);
          const isCO = isSameDay(giornoSelezionato, co);
          const notti = differenceInDays(co, ci);
          const quotaGiorno = isCO ? 0 : (notti > 0 && p.importo_totale > 0 ? p.importo_totale / notti : 0);
          return (
            <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
              {!soloCalendario && (
                <div className="flex gap-2 flex-shrink-0 text-right">
                  <span className="w-12 text-gray-500">
                    {quotaGiorno > 0 ? `€${quotaGiorno.toFixed(0)}` : '—'}
                  </span>
                  <span className="w-14 font-semibold text-gray-700">
                    {!isCO && p.importo_totale > 0 ? `€${p.importo_totale.toFixed(0)}` : '—'}
                  </span>
                  <span className="w-10 text-amber-600">
                    {!isCO && p.tassa_soggiorno ? `€${p.tassa_soggiorno.toFixed(0)}` : '—'}
                  </span>
                </div>
              )}
            </div>
          );
        };

        const allGuests = [...partenze, ...arrivi, ...presenti];
        const totalQuotaGiorno = [...arrivi, ...presenti].reduce((s, p) => {
          const n = differenceInDays(parseISO(p.check_out), parseISO(p.check_in));
          return s + (n > 0 && p.importo_totale > 0 ? p.importo_totale / n : 0);
        }, 0);
        const totalAffitto = [...arrivi, ...presenti].reduce((s, p) => s + p.importo_totale, 0);
        const totalTassa   = [...arrivi, ...presenti].reduce((s, p) => s + (p.tassa_soggiorno ?? 0), 0);
        const hasAmounts = allGuests.some(p => p.importo_totale > 0);

        return (
          <>
            {!soloCalendario && hasAmounts && (
              <div className="flex justify-end gap-2 text-[10px] text-gray-400 pb-1 mb-1 border-b border-gray-100">
                <span className="w-12 text-right">x giorno</span>
                <span className="w-14 text-right">affitto</span>
                <span className="w-10 text-right">tassa</span>
              </div>
            )}
            {partenze.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-1">
                  Partenze ({partenze.length})
                </p>
                <div>{partenze.map(renderRow)}</div>
                {(arrivi.length > 0 || presenti.length > 0) && <hr className="my-2 border-gray-200" />}
              </>
            )}
            {arrivi.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1">
                  Arrivi ({arrivi.length})
                </p>
                <div>{arrivi.map(renderRow)}</div>
                {presenti.length > 0 && <hr className="my-2 border-gray-200" />}
              </>
            )}
            {presenti.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">
                  Presenti ({presenti.length})
                </p>
                <div>{presenti.map(renderRow)}</div>
              </>
            )}
            {!soloCalendario && hasAmounts && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-300">
                <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wide">Totale</span>
                <div className="flex gap-2 text-right">
                  <span className="w-12 font-semibold text-gray-700 text-xs">€{totalQuotaGiorno.toFixed(0)}</span>
                  <span className="w-14 font-bold text-gray-800 text-xs">€{totalAffitto.toFixed(0)}</span>
                  <span className="w-10 font-bold text-amber-600 text-xs">{totalTassa > 0 ? `€${totalTassa.toFixed(0)}` : '—'}</span>
                </div>
              </div>
            )}
          </>
        );
      })()}
    </>
  );

  // Pulsanti azione (sync iCal + toggle vista) — riusati in row 1 (mobile) e row 2 (desktop)
  const azioniJSX = (
    <>
      {!soloCalendario && (
        <>
          {syncMsg && (
            <span className={`hidden sm:inline text-xs px-2 py-1 rounded ${
              syncOk === false ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}>{syncMsg}</span>
          )}
        <button
          onClick={syncIcal}
          disabled={syncing}
          className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
            syncOk === true  ? 'border-green-300 bg-green-50 text-green-700' :
            syncOk === false ? 'border-red-300 bg-red-50 text-red-700' :
            'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Sync iCal</span>
        </button>
        </>
      )}
      {!soloCalendario && (
        <button
          onClick={() => setVistaCompatta(v => !v)}
          title={vistaCompatta ? 'Vista estesa' : 'Vista compatta'}
          className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
            vistaCompatta
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {vistaCompatta ? <CalendarDays size={14} /> : <LayoutGrid size={14} />}
          <span className="hidden sm:inline">{vistaCompatta ? 'Esteso' : 'Compatto'}</span>
        </button>
      )}
    </>
  );

  // Riepilogo pulizie in versione compatta (pallini con tooltip) — solo desktop, tra mese e pulsanti
  const pulizieCompattoJSX = (pulizieCheckout.length > 0 || pulizieCambio.length > 0) && (
    <div className="flex items-center gap-3">
      {pulizieCheckout.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-orange-500 uppercase">CO</span>
          <div className="flex -space-x-0.5">
            {pulizieCheckout.map((p) => {
              const cam = camere.find((c) => c.id === p.camera_id);
              const st = getCameraStyle(p.camera_id, cam?.colore);
              return (
                <div
                  key={p.id}
                  title={`${cam?.nome ?? 'Camera'} — ${p.ospite_nome}`}
                  className={`w-2.5 h-2.5 rounded-full ring-1 ring-white ${st.dot}`}
                />
              );
            })}
          </div>
        </div>
      )}
      {pulizieCambio.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-blue-500 uppercase">Cambio</span>
          <div className="flex -space-x-0.5">
            {pulizieCambio.map((p) => {
              const cam = camere.find((c) => c.id === p.camera_id);
              const st = getCameraStyle(p.camera_id, cam?.colore);
              const nottiTrascorse = differenceInDays(giornoSelezionato, parseISO(p.check_in));
              return (
                <div
                  key={p.id}
                  title={`${cam?.nome ?? 'Camera'} — ${p.ospite_nome} (${nottiTrascorse}n)`}
                  className={`w-2.5 h-2.5 rounded-full ring-1 ring-white ${st.dot}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Row 1: title + buttons (solo mobile, icon-only — su desktop i pulsanti si spostano in row 2) */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Calendario</h1>
        <div className="flex items-center gap-2 sm:hidden">
          {azioniJSX}
        </div>
      </div>

      {/* Row 2: navigazione mese + filtro giorno accanto (esteso su desktop, compatto su mobile) — su desktop anche riepilogo pulizie compatto + pulsanti sulla stessa riga */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
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
          <div className="hidden sm:flex">
            {giornoNavJSX}
          </div>
          <div className="sm:hidden flex">
            {giornoNavCompactJSX}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          {pulizieCompattoJSX}
          <div className="flex items-center gap-2">{azioniJSX}</div>
        </div>
      </div>

      {/* Riepilogo pulizie del giorno selezionato — versione estesa, solo mobile (su desktop vedi row 2) */}
      {(pulizieCheckout.length > 0 || pulizieCambio.length > 0) && (
        <div className="sm:hidden bg-white rounded-lg shadow-sm p-3 grid grid-cols-1 gap-3">
          <div>
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-1">
              Check-out da pulire ({pulizieCheckout.length})
            </p>
            {pulizieCheckout.length === 0 ? (
              <p className="text-xs text-gray-400">Nessuna</p>
            ) : (
              <div className="space-y-1">
                {pulizieCheckout.map((p) => {
                  const cam = camere.find((c) => c.id === p.camera_id);
                  const st = getCameraStyle(p.camera_id, cam?.colore);
                  return (
                    <div key={p.id} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                      <span className="font-medium text-gray-700">{cam?.nome}</span>
                      <span className="text-gray-400 truncate">{p.ospite_nome}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">
              Cambio stanza – soggiorni lunghi ({pulizieCambio.length})
            </p>
            {pulizieCambio.length === 0 ? (
              <p className="text-xs text-gray-400">Nessuna</p>
            ) : (
              <div className="space-y-1">
                {pulizieCambio.map((p) => {
                  const cam = camere.find((c) => c.id === p.camera_id);
                  const st = getCameraStyle(p.camera_id, cam?.colore);
                  const nottiTrascorse = differenceInDays(giornoSelezionato, parseISO(p.check_in));
                  return (
                    <div key={p.id} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                      <span className="font-medium text-gray-700">{cam?.nome}</span>
                      <span className="text-gray-400 truncate">{p.ospite_nome}</span>
                      <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">{nottiTrascorse}n</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
        {!soloCalendario && (
          <span>Prenotazioni: <strong className="text-green-700">€{entrateDelMese.toFixed(2)}</strong></span>
        )}
        <span><strong className="text-blue-700">{camereDelGiorno}</strong> <span className="text-gray-400">cam</span></span>
        <span><strong className="text-purple-700">{ospititDelGiorno}</strong> <span className="text-gray-400">osp</span></span>
      </div>

      {/* Vista compatta: 2 colonne, cerchi colorati sui giorni */}
      {vistaEffettiva && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {camere.map(camera => {
            const stile = getCameraStyle(camera.id, camera.colore);
            return (
              <div key={camera.id} className="bg-white rounded-xl shadow-sm px-2 pt-2 pb-2">
                <div className="grid grid-cols-7 mb-0.5">
                  {GIORNI_SETTIMANA.map((g, i) => (
                    <div key={i} className="flex items-center justify-center">
                      <span className="text-[8px] font-semibold text-gray-400">{g}</span>
                    </div>
                  ))}
                </div>
                {settimane.map((settimana, si) => (
                  <div key={si} className="grid grid-cols-7">
                    {settimana.map((day, di) => {
                      if (!day) return <div key={di} className="h-[18px]" />;
                      const { occupied } = getDayInfo(day, camera.id);
                      const isToday    = isSameDay(day, today);
                      const isSelected = isSameDay(day, giornoSelezionato);
                      return (
                        <div key={di} className="flex items-center justify-center py-[1px]">
                          <div
                            onClick={() => setGiornoSelezionato(day)}
                            onDoubleClick={() => !soloCalendario && setNuovaPrenotazione({ cameraId: camera.id, checkIn: format(day, 'yyyy-MM-dd') })}
                            className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[8px] font-medium cursor-pointer select-none
                              ${occupied ? `${stile.pieno}` : 'text-gray-600 hover:bg-black/5'}
                              ${isToday    ? 'ring-1 ring-blue-400 ring-offset-0' : ''}
                              ${isSelected && !occupied ? 'outline outline-1 outline-gray-400' : ''}
                            `}
                          >
                            {format(day, 'd')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stile.dot}`} />
                  <span className="text-[9px] font-semibold text-gray-700 truncate">{camera.nome}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lista giorno visibile sotto la vista compatta */}
      {vistaEffettiva && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          {listaGiornoJSX}
        </div>
      )}

      {/* Vista estesa: griglia mini-calendari con pill bar */}
      {!vistaEffettiva && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:grid-cols-3">
        {camere.map((camera, idx) => {
          const stile = getCameraStyle(camera.id, camera.colore);
          return (
            <Fragment key={camera.id}>
            <div className="bg-white rounded-xl shadow-sm px-2 pt-2 pb-1">
              {/* Camera header */}
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${stile.dot}`} />
                <span className="font-semibold text-gray-800 text-xs">{camera.nome}</span>
                {!soloCalendario && <span className="text-[10px] text-gray-400 ml-auto">€{camera.prezzo_notte.toFixed(2)}/n</span>}
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
                    // ci <= day < co  (check-out NON colorato)
                    if (isBefore(day, ci) || !isBefore(day, co)) return;
                    visti.add(p.id);

                    let first = -1, last = -1;
                    settimana.forEach((d, i) => {
                      if (!d) return;
                      if (!isBefore(d, ci) && isBefore(d, co)) {
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
                      // la pill finisce se l'ultimo giorno colorato è l'ultima notte (check_out - 1)
                      isEnd: isSameDay(addDays(settimana[last]!, 1), co),
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

      )}

      {/* Lista prenotazioni del giorno — solo mobile, solo vista estesa */}
      {!soloCalendario && !vistaEffettiva && (
        <div className="md:hidden bg-white rounded-lg shadow-sm p-5">
          {listaGiornoJSX}
        </div>
      )}

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
