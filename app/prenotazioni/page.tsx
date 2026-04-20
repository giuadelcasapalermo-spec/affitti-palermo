'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { Prenotazione, Uscita, Entrata } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { differenceInDays, parseISO, format, startOfMonth, endOfMonth, isToday, isTomorrow } from 'date-fns';
import { it } from 'date-fns/locale';
import { fData } from '@/lib/utils';
import { Pencil, Trash2, Plus, X, Euro, TrendingDown, TrendingUp, BookOpen, Landmark, Check, Sparkles, Moon, MessageCircle, User, CalendarRange, RefreshCw } from 'lucide-react';
import PrenotazioneForm from '@/components/PrenotazioneForm';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';

function statoColore(stato: Prenotazione['stato']) {
  if (stato === 'confermata') return 'bg-green-100 text-green-800';
  if (stato === 'pending')    return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

const oggi = new Date();
const DEFAULT_DAL = format(oggi, 'yyyy-MM-dd');
const DEFAULT_AL  = format(endOfMonth(oggi),   'yyyy-MM-dd');

function getLabelData(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Oggi';
  if (isTomorrow(date)) return 'Domani';
  const label = format(date, 'EEEE d MMMM yyyy', { locale: it });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDateRange(checkIn: string, checkOut: string): string {
  const ci = parseISO(checkIn);
  const co = parseISO(checkOut);
  return `${format(ci, 'd MMM', { locale: it })} - ${format(co, 'd MMM yyyy', { locale: it })}`;
}

const INPUT = 'border border-gray-300 rounded px-1.5 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-400';
const INPUT_RIGHT = INPUT + ' text-right';

function PrenotazioniInner() {
  const searchParams = useSearchParams();
  const camere = useCamere();
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[]>([]);
  const [uscite,  setUscite]  = useState<Uscita[]>([]);
  const [entrate, setEntrate] = useState<Entrata[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostraForm, setMostraForm] = useState(searchParams.get('nuova') === '1');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editValues, setEditValues]   = useState<Partial<Prenotazione>>({});
  const [filtroStato,  setFiltroStato]  = usePersistedState('pren-stato',   'tutti');
  const [filtroCamera, setFiltroCamera] = usePersistedState('pren-camera',  'tutte');
  const [filtroOspite, setFiltroOspite] = usePersistedState('pren-ospite',  '');
  const [filtroDal, setFiltroDal] = usePersistedState('pren-dal', DEFAULT_DAL);
  const [filtroAl,  setFiltroAl]  = usePersistedState('pren-al',  DEFAULT_AL);
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk]   = useState<boolean | null>(null);

  const carica = useCallback(() => {
    fetch('/api/prenotazioni').then(r => r.json()).then(data => {
      setPrenotazioni(data.sort((a: Prenotazione, b: Prenotazione) =>
        a.check_in.localeCompare(b.check_in)
      ));
      setLoading(false);
    });
    fetch('/api/uscite').then(r => r.json()).then(setUscite);
    fetch('/api/entrate').then(r => r.json()).then(setEntrate);
  }, []);

  useEffect(() => { carica(); }, [carica]);

  async function syncIcal() {
    setSyncing(true);
    setSyncOk(null);
    try {
      const res = await fetch("/api/sync-gmail", { method: "POST" });
      const json = await res.json();
      setSyncOk(json.ok !== false);
      carica();
    } catch {
      setSyncOk(false);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncOk(null), 3000);
    }
  }

  async function crea(data: Partial<Prenotazione>) {
    await fetch('/api/prenotazioni', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    setMostraForm(false);
    carica();
  }

  async function aggiorna(id: string, data: Partial<Prenotazione>) {
    await fetch(`/api/prenotazioni/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    setEditingId(null);
    carica();
  }

  async function elimina(id: string) {
    if (!confirm('Eliminare questa prenotazione?')) return;
    await fetch(`/api/prenotazioni/${id}`, { method: 'DELETE' });
    carica();
  }

  function startEdit(p: Prenotazione) {
    setEditingId(p.id);
    setEditValues({ ...p });
  }

  function setEV(k: keyof Prenotazione, v: string | number | undefined) {
    setEditValues(prev => ({ ...prev, [k]: v }));
  }

  async function salvaInline() {
    if (!editingId) return;
    await aggiorna(editingId, {
      ...editValues,
      importo_totale:  Number(editValues.importo_totale)  || 0,
      tassa_soggiorno: editValues.tassa_soggiorno ? Number(editValues.tassa_soggiorno) : undefined,
    });
  }

  const nomiOspiti = Array.from(new Set(prenotazioni.map(p => p.ospite_nome))).sort();

  const filtrate = prenotazioni.filter(p => {
    if (filtroStato  !== 'tutti'  && p.stato     !== filtroStato)          return false;
    if (filtroCamera !== 'tutte'  && p.camera_id !== Number(filtroCamera)) return false;
    if (filtroOspite && !p.ospite_nome.toLowerCase().includes(filtroOspite.toLowerCase())) return false;
    if (filtroDal && p.check_in < filtroDal) return false;
    if (filtroAl  && p.check_in > filtroAl)  return false;
    return true;
  });

  // Raggruppamento per data check-in (usato nella vista mobile)
  const groupedEntries = Object.entries(
    filtrate.reduce((acc, p) => {
      if (!acc[p.check_in]) acc[p.check_in] = [];
      acc[p.check_in].push(p);
      return acc;
    }, {} as Record<string, Prenotazione[]>)
  ).sort((a, b) => a[0].localeCompare(b[0]));

  const confermate = prenotazioni.filter(
    p => p.stato === 'confermata' && p.importo_totale > 0 && p.check_in >= filtroDal && p.check_in <= filtroAl
  );
  const kpiPrenotazioni = confermate.length;
  const kpiImporto      = confermate.reduce((s, p) => s + p.importo_totale, 0);
  const kpiTassa        = confermate.reduce((s, p) => s + (p.tassa_soggiorno ?? 0), 0);
  const kpiUscite       = uscite.filter(u => u.data >= filtroDal && u.data <= filtroAl).reduce((s, u) => s + u.importo, 0);
  const kpiEntrate      = entrate.filter(e => e.data >= filtroDal && e.data <= filtroAl).reduce((s, e) => s + e.importo, 0);
  const kpiSaldo        = kpiEntrate - kpiUscite;
  const filtroModificato = filtroDal !== DEFAULT_DAL || filtroAl !== DEFAULT_AL;

  if (loading) return <div className="text-gray-400 py-10 text-center">Caricamento...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Prenotazioni</h1>
        <div className="flex gap-2">
          <button
            onClick={syncIcal}
            disabled={syncing}
            className={`flex items-center gap-1.5 border px-4 py-2 rounded text-sm font-medium transition-colors ${
              syncOk === true  ? 'border-green-300 bg-green-50 text-green-700' :
              syncOk === false ? 'border-red-300 bg-red-50 text-red-700' :
              'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            Sync Gmail
          </button>
          <button
            onClick={() => {
              const url = `/api/pulizie?dal=${filtroDal}&al=${filtroAl}`;
              window.open(url, '_blank');
            }}
            className="flex items-center gap-1.5 border border-purple-300 bg-purple-50 text-purple-700 px-4 py-2 rounded text-sm font-medium hover:bg-purple-100"
          >
            <Sparkles size={15} /> Pulizia
          </button>
          <button
            onClick={() => setMostraForm(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={15} /> Nuova
          </button>
        </div>
      </div>

      {/* KPI mobile compatto */}
      <div className="sm:hidden bg-white rounded-lg shadow-sm px-4 py-3 grid grid-cols-3 gap-y-3 divide-x divide-gray-100">
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Prenotazioni</div>
          <div className="text-base font-bold text-gray-800">{kpiPrenotazioni}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Previsionali</div>
          <div className="text-base font-bold text-gray-800">€{kpiImporto.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400">Tassa sogg.</div>
          <div className="text-base font-bold text-amber-600">€{kpiTassa.toFixed(0)}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Uscite</div>
          <div className="text-base font-bold text-red-600">-€{kpiUscite.toFixed(0)}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Entrate</div>
          <div className="text-base font-bold text-green-700">+€{kpiEntrate.toFixed(0)}</div>
        </div>
        <div className="text-center pt-2">
          <div className="text-[11px] text-gray-400">Saldo</div>
          <div className={`text-base font-bold ${kpiSaldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>€{kpiSaldo.toFixed(0)}</div>
        </div>
      </div>

      {/* KPI cards desktop */}
      <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-blue-100 rounded-full p-2"><BookOpen size={20} className="text-blue-600" /></div>
          <div><div className="text-sm text-gray-500">Prenotazioni</div><div className="text-lg font-bold text-gray-800">{kpiPrenotazioni}</div></div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2"><Euro size={20} className="text-green-600" /></div>
          <div><div className="text-sm text-gray-500">Previsionali</div><div className="text-lg font-bold text-gray-800">€{kpiImporto.toFixed(2)}</div></div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-amber-100 rounded-full p-2"><Landmark size={20} className="text-amber-600" /></div>
          <div><div className="text-sm text-gray-500">Tassa soggiorno</div><div className="text-lg font-bold text-amber-600">€{kpiTassa.toFixed(2)}</div></div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-red-100 rounded-full p-2"><TrendingDown size={20} className="text-red-600" /></div>
          <div><div className="text-sm text-gray-500">Uscite del periodo</div><div className="text-lg font-bold text-red-600">-€{kpiUscite.toFixed(2)}</div></div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2"><TrendingUp size={20} className="text-green-600" /></div>
          <div><div className="text-sm text-gray-500">Entrate effettive</div><div className="text-lg font-bold text-green-700">+€{kpiEntrate.toFixed(2)}</div></div>
        </div>
        <div className={`rounded-lg shadow-sm p-4 flex items-center gap-3 ${kpiSaldo >= 0 ? 'bg-white' : 'bg-red-50'}`}>
          <div className={`rounded-full p-2 ${kpiSaldo >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
            <TrendingUp size={20} className={kpiSaldo >= 0 ? 'text-green-600' : 'text-red-600'} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Saldo effettivo</div>
            <div className={`text-lg font-bold ${kpiSaldo >= 0 ? 'text-green-700' : 'text-red-600'}`}>€{kpiSaldo.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Form nuova prenotazione */}
      {mostraForm && (
        <div className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-blue-500">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Nuova prenotazione</h2>
            <button onClick={() => setMostraForm(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <PrenotazioneForm onSalva={crea} onAnnulla={() => setMostraForm(false)} />
        </div>
      )}

      {/* Filtri */}
      <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
            <option value="tutti">Tutti gli stati</option>
            <option value="confermata">Confermata</option>
            <option value="pending">In attesa</option>
            <option value="cancellata">Cancellata</option>
          </select>
          <select value={filtroCamera} onChange={e => setFiltroCamera(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
            <option value="tutte">Tutte le camere</option>
            {camere.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <div className="relative">
            <input
              type="text"
              list="ospiti-list"
              value={filtroOspite}
              onChange={e => setFiltroOspite(e.target.value)}
              placeholder="Cerca ospite..."
              className="border rounded px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {filtroOspite && (
              <button
                onClick={() => setFiltroOspite('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
            <datalist id="ospiti-list">
              {nomiOspiti.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <span className="text-sm text-gray-500 ml-auto">{filtrate.length} prenotazioni trovate</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap border-t pt-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Periodo check-in</span>
          <div className="flex items-center gap-2">
            <input type="date" value={filtroDal} onChange={e => setFiltroDal(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={filtroAl}  onChange={e => setFiltroAl(e.target.value)}  className="border rounded px-2 py-1 text-sm" />
          </div>
          {filtroModificato && (
            <button onClick={() => { setFiltroDal(DEFAULT_DAL); setFiltroAl(DEFAULT_AL); }} className="text-sm text-blue-600 hover:underline">
              Mese corrente
            </button>
          )}
        </div>
      </div>

      {/* ── Lista mobile ── */}
      <div className="sm:hidden -mx-4 bg-gray-50 pb-8 pt-1">
        {filtrate.length === 0 ? (
          <div className="text-center text-gray-400 py-12 text-sm">Nessuna prenotazione trovata</div>
        ) : (
          groupedEntries.map(([dateStr, prenotazioniGruppo]) => (
            <div key={dateStr}>
              {/* Intestazione gruppo data */}
              <div className="px-4 pt-4 pb-2 text-blue-600 font-semibold text-sm">
                {getLabelData(dateStr)}
              </div>
              {/* Card prenotazione */}
              {prenotazioniGruppo.map(p => {
                const cam = camere.find(c => c.id === p.camera_id);
                const notiMob = (p.check_in && p.check_out)
                  ? differenceInDays(parseISO(p.check_out), parseISO(p.check_in))
                  : 0;
                return (
                  <div
                    key={p.id}
                    className="mx-3 mb-3 bg-white rounded-xl p-4 relative shadow-sm border border-gray-100"
                    onDoubleClick={() => startEdit(p)}
                  >
                    {/* Nome + badge */}
                    <div className="flex items-center gap-2 mb-2.5 pr-10 flex-wrap">
                      <span className="font-bold text-gray-900 text-[15px]">{p.ospite_nome}</span>
                      {p.fonte === 'ical' && (
                        <span className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                          Booking
                        </span>
                      )}
                      {p.stato === 'pending' && (
                        <span className="bg-yellow-400 text-yellow-900 text-[11px] font-bold px-2 py-0.5 rounded">
                          In attesa
                        </span>
                      )}
                      {p.stato === 'cancellata' && (
                        <span className="bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded">
                          Cancellata
                        </span>
                      )}
                    </div>

                    {/* Icona chat in alto a destra */}
                    <button className="absolute top-4 right-4 text-gray-300 active:text-gray-500">
                      <MessageCircle size={22} strokeWidth={1.5} />
                    </button>

                    {/* Date range */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-1.5">
                      <CalendarRange size={15} className="text-gray-400 flex-shrink-0" />
                      <span>{formatDateRange(p.check_in, p.check_out)}</span>
                    </div>
                    {/* Notti */}
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-1.5">
                      <Moon size={15} className="text-gray-400 flex-shrink-0" />
                      <span>{notiMob} {notiMob === 1 ? 'notte' : 'notti'}</span>
                    </div>
                    {/* Telefono o note */}
                    {(p.ospite_telefono || p.note) && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-1.5">
                        <User size={15} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{p.ospite_telefono || p.note}</span>
                      </div>
                    )}

                    {/* Separatore */}
                    <div className="border-t border-gray-100 mt-2.5 pt-2.5 flex items-center justify-between">
                      {/* Camera */}
                      <span className="text-xs text-gray-400">{cam?.nome ?? 'GiuAdel casa Palermo'}</span>
                      {/* Valore economico */}
                      <div className="flex items-center gap-2">
                        {p.tassa_soggiorno ? (
                          <span className="text-xs text-amber-600 font-medium">
                            TdS €{p.tassa_soggiorno.toFixed(0)}
                          </span>
                        ) : null}
                        {p.importo_totale > 0 ? (
                          <span className="text-base font-bold text-gray-900">
                            €{p.importo_totale.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Tabella (solo desktop) */}
      <div className="hidden sm:block bg-white rounded-lg shadow-sm overflow-x-auto">
        {filtrate.length === 0 ? (
          <div className="text-center text-gray-400 py-12">Nessuna prenotazione trovata</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Ospite</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Camera</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Check-in</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600">Check-out</th>
                <th className="text-right px-3 py-3 font-medium text-gray-600">Notti</th>
                <th className="text-right px-3 py-3 font-medium text-gray-600">Importo</th>
                <th className="text-right px-3 py-3 font-medium text-gray-600">T.d.S.</th>
                <th className="text-center px-3 py-3 font-medium text-gray-600">Stato</th>
                <th className="px-3 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtrate.map(p => {
                const isEditing = editingId === p.id;
                const ev = editValues;
                const ciStr  = isEditing ? (ev.check_in  as string) : p.check_in;
                const coStr  = isEditing ? (ev.check_out as string) : p.check_out;
                const notti  = (ciStr && coStr) ? differenceInDays(parseISO(coStr), parseISO(ciStr)) : 0;
                const camera = camere.find(c => c.id === (isEditing ? ev.camera_id : p.camera_id));

                if (isEditing) {
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b bg-blue-50">
                        {/* Ospite */}
                        <td className="px-2 py-2 space-y-1">
                          <input
                            type="text"
                            value={(ev.ospite_nome as string) ?? ''}
                            onChange={e => setEV('ospite_nome', e.target.value)}
                            className={INPUT}
                            placeholder="Nome ospite"
                          />
                          <input
                            type="tel"
                            value={(ev.ospite_telefono as string) ?? ''}
                            onChange={e => setEV('ospite_telefono', e.target.value)}
                            className={INPUT + ' text-xs text-gray-500'}
                            placeholder="Telefono"
                          />
                        </td>
                        {/* Camera */}
                        <td className="px-2 py-2">
                          <select
                            value={ev.camera_id as number}
                            onChange={e => setEV('camera_id', Number(e.target.value))}
                            className={INPUT}
                          >
                            {camere.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </select>
                        </td>
                        {/* Check-in */}
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={(ev.check_in as string) ?? ''}
                            onChange={e => setEV('check_in', e.target.value)}
                            className={INPUT}
                          />
                        </td>
                        {/* Check-out */}
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={(ev.check_out as string) ?? ''}
                            onChange={e => setEV('check_out', e.target.value)}
                            className={INPUT}
                          />
                        </td>
                        {/* Notti */}
                        <td className="px-2 py-2 text-right text-gray-600 font-medium">{notti > 0 ? notti : '—'}</td>
                        {/* Importo */}
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={(ev.importo_totale as number) ?? 0}
                            onChange={e => setEV('importo_totale', e.target.value)}
                            className={INPUT_RIGHT}
                          />
                        </td>
                        {/* Tassa */}
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={(ev.tassa_soggiorno as number) ?? ''}
                            onChange={e => setEV('tassa_soggiorno', e.target.value ? Number(e.target.value) : undefined)}
                            className={INPUT_RIGHT}
                            placeholder="0"
                          />
                        </td>
                        {/* Stato */}
                        <td className="px-2 py-2">
                          <select
                            value={ev.stato as string}
                            onChange={e => setEV('stato', e.target.value)}
                            className={INPUT}
                          >
                            <option value="confermata">Confermata</option>
                            <option value="pending">In attesa</option>
                            <option value="cancellata">Cancellata</option>
                          </select>
                        </td>
                        {/* Azioni */}
                        <td className="px-2 py-2">
                          <div className="flex gap-1 justify-end">
                            <button onClick={salvaInline} title="Salva" className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-50">
                              <Check size={16} />
                            </button>
                            <button onClick={() => setEditingId(null)} title="Annulla" className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
                              <X size={16} />
                            </button>
                            <button onClick={() => elimina(p.id)} title="Elimina" className="text-gray-300 hover:text-red-600 p-1 rounded hover:bg-red-50">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Riga note */}
                      <tr className="bg-blue-50 border-b">
                        <td colSpan={9} className="px-3 pb-2">
                          <input
                            type="text"
                            value={(ev.note as string) ?? ''}
                            onChange={e => setEV('note', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-xs w-full text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            placeholder="Note..."
                          />
                        </td>
                      </tr>
                    </Fragment>
                  );
                }

                // ── Riga visualizzazione ──
                return (
                  <tr
                    key={p.id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onDoubleClick={() => startEdit(p)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-800">{p.ospite_nome}</span>
                        {p.fonte === 'ical' && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">BK</span>
                        )}
                      </div>
                      {p.ospite_telefono && <div className="text-xs text-gray-400">{p.ospite_telefono}</div>}
                      {p.note && <div className="text-xs text-gray-400 truncate max-w-[160px]">{p.note}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{camera?.nome}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fData(p.check_in)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fData(p.check_out)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{notti}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-800">
                      {p.importo_totale > 0 ? `€${p.importo_totale.toFixed(2)}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm">
                      {p.tassa_soggiorno
                        ? <span className="text-amber-600 font-medium">€{p.tassa_soggiorno.toFixed(2)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statoColore(p.stato)}`}>
                        {p.stato === 'confermata' ? 'Confermata' : p.stato === 'pending' ? 'In attesa' : 'Cancellata'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEdit(p)} title="Modifica" className="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => elimina(p.id)} title="Elimina" className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function PrenotazioniPage() {
  return (
    <Suspense>
      <PrenotazioniInner />
    </Suspense>
  );
}
