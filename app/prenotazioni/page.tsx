'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { Prenotazione } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { differenceInDays, parseISO, format, startOfMonth, endOfMonth, addMonths, isToday, isTomorrow } from 'date-fns';
import { it } from 'date-fns/locale';
import { fData } from '@/lib/utils';
import { Pencil, Trash2, Plus, X, Euro, BookOpen, Landmark, Check, Moon, User, CalendarRange, RefreshCw, ChevronLeft, ChevronRight, Mail, MessageCircle, Loader2 } from 'lucide-react';
import PrenotazioneForm from '@/components/PrenotazioneForm';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';

type CheckinStatus = {
  linkInviato: boolean;
  linkCreatedAt: string | null;
  alloggiatiCount: number;
};

function statoColore(stato: Prenotazione['stato']) {
  if (stato === 'confermata') return 'bg-green-100 text-green-800';
  if (stato === 'pending')    return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

// Prenotazioni create dalla sync iCal ma senza nome/importo reali: Booking.com non li
// fornisce più via email, vanno completate a mano (da Pulse/extranet) modificandole qui.
function daCompletare(p: Prenotazione): boolean {
  if (p.stato === 'cancellata') return false;
  if (p.fonte !== 'ical') return false;
  const nomeVuoto = !p.ospite_nome?.trim() || p.ospite_nome === 'Ospite Booking.com';
  return nomeVuoto || !p.importo_totale;
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
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [righeSkippate, setRigheSkippate] = useState<string[]>([]);
  const [checkinStatus, setCheckinStatus] = useState<Record<string, CheckinStatus>>({});
  const [editingCard, setEditingCard] = useState<Prenotazione | null>(null);
  const [invioWA, setInvioWA] = useState<Record<string, 'idle' | 'loading' | 'ok' | 'error'>>({});
  const [invioIstr, setInvioIstr] = useState<Record<string, 'idle' | 'loading' | 'ok' | 'error'>>({});

  const carica = useCallback(() => {
    fetch('/api/prenotazioni').then(r => r.json()).then(data => {
      setPrenotazioni(data.sort((a: Prenotazione, b: Prenotazione) =>
        a.check_in.localeCompare(b.check_in)
      ));
      setLoading(false);
    });
  }, []);

  useEffect(() => { carica(); }, [carica]);

  useEffect(() => {
    if (prenotazioni.length === 0) return;
    const ids = prenotazioni.map(p => p.id).join(',');
    fetch(`/api/alloggiati/checkin-status?ids=${ids}`)
      .then(r => r.json())
      .then(setCheckinStatus)
      .catch(() => {});
  }, [prenotazioni]);

  async function syncIcal() {
    setSyncing(true);
    setSyncOk(null);
    setSyncMsg(null);
    setRigheSkippate([]);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const json = await res.json();
      const ok = json.ok !== false;
      setSyncOk(ok);
      const totIcal = (json.risultati ?? []).reduce((s: number, r: { aggiunte: number }) => s + r.aggiunte, 0);
      const arricchite = json.prenotazioniArricchite ?? 0;
      const sheetsOff = !json.sheetsConfigurato;
      const sheetsErr = json.sheetsErrore;
      const skippate: string[] = json.righeSkippate ?? [];
      let msg = `iCal: +${totIcal}`;
      if (sheetsOff)  msg += ' · Sheet: non configurato';
      else if (sheetsErr) msg += ` · Sheet errore: ${sheetsErr}`;
      else {
        msg += ` · Sheet: ${arricchite} aggiornate`;
        if (skippate.length > 0) msg += ` · ${skippate.length} righe saltate`;
      }
      setSyncMsg(msg);
      setRigheSkippate(skippate);
      carica();
    } catch {
      setSyncOk(false);
      setSyncMsg('Errore di rete');
    } finally {
      setSyncing(false);
      setTimeout(() => { setSyncOk(null); setSyncMsg(null); }, 6000);
    }
  }

  async function inviaLinkWhatsApp(prenotazioneId: string, telefono: string) {
    setInvioWA(prev => ({ ...prev, [prenotazioneId]: 'loading' }));
    try {
      const res = await fetch('/api/alloggiati/invia-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prenotazione_id: prenotazioneId, canale: 'whatsapp_link' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.errore ?? 'Errore');
      const num = telefono.trim().replace(/[\s\-().]/g, '');
      const waNum = num.startsWith('+') ? num.slice(1)
                  : num.startsWith('00') ? num.slice(2)
                  : num.startsWith('3') && num.length === 10 ? '39' + num
                  : num;
      window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(json.testo)}`, '_blank');
      setInvioWA(prev => ({ ...prev, [prenotazioneId]: 'ok' }));
    } catch {
      setInvioWA(prev => ({ ...prev, [prenotazioneId]: 'error' }));
    }
    setTimeout(() => setInvioWA(prev => ({ ...prev, [prenotazioneId]: 'idle' })), 5000);
  }

  async function inviaIstruzioni(prenotazioneId: string, telefono: string) {
    setInvioIstr(prev => ({ ...prev, [prenotazioneId]: 'loading' }));
    try {
      const res = await fetch('/api/alloggiati/invia-istruzioni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prenotazione_id: prenotazioneId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.errore ?? 'Errore');
      const num = telefono.trim().replace(/[\s\-().]/g, '');
      const waNum = num.startsWith('+') ? num.slice(1)
                  : num.startsWith('00') ? num.slice(2)
                  : num.startsWith('3') && num.length === 10 ? '39' + num
                  : num;
      window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(json.testo)}`, '_blank');
      setInvioIstr(prev => ({ ...prev, [prenotazioneId]: 'ok' }));
    } catch {
      setInvioIstr(prev => ({ ...prev, [prenotazioneId]: 'error' }));
    }
    setTimeout(() => setInvioIstr(prev => ({ ...prev, [prenotazioneId]: 'idle' })), 5000);
  }

  function crea(data: Partial<Prenotazione>) {
    const id = crypto.randomUUID();
    const optimistic: Prenotazione = {
      id,
      struttura_id: '',
      camera_id: data.camera_id!,
      ospite_nome: data.ospite_nome ?? '',
      ospite_telefono: data.ospite_telefono ?? '',
      ospite_email: data.ospite_email ?? '',
      check_in: data.check_in ?? '',
      check_out: data.check_out ?? '',
      importo_totale: data.importo_totale ?? 0,
      tassa_soggiorno: data.tassa_soggiorno,
      stato: data.stato ?? 'confermata',
      note: data.note ?? '',
      created_at: new Date().toISOString(),
      fonte: 'manuale',
    };
    setPrenotazioni(prev => [...prev, optimistic].sort((a, b) => a.check_in.localeCompare(b.check_in)));
    setMostraForm(false);
    fetch('/api/prenotazioni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, id }),
    })
      .then(r => r.json())
      .then(saved => setPrenotazioni(prev => prev.map(p => p.id === id ? saved : p)))
      .catch(() => setPrenotazioni(prev => prev.filter(p => p.id !== id)));
  }

  function aggiorna(id: string, data: Partial<Prenotazione>) {
    setPrenotazioni(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
    setEditingId(null);
    setEditingCard(null);
    fetch(`/api/prenotazioni/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(r => r.json())
      .then(saved => setPrenotazioni(prev => prev.map(p => p.id === id ? saved : p)))
      .catch(() => carica());
  }

  function elimina(id: string) {
    if (!confirm('Eliminare questa prenotazione?')) return;
    const backup = prenotazioni.find(p => p.id === id);
    setPrenotazioni(prev => prev.filter(p => p.id !== id));
    fetch(`/api/prenotazioni/${id}`, { method: 'DELETE' })
      .catch(() => { if (backup) setPrenotazioni(prev => [...prev, backup].sort((a, b) => a.check_in.localeCompare(b.check_in))); });
  }

  function startEdit(p: Prenotazione) {
    setEditingId(p.id);
    setEditValues({ ...p });
  }

  function setEV(k: keyof Prenotazione, v: string | number | undefined) {
    setEditValues(prev => ({ ...prev, [k]: v }));
  }

  function aggiornaCard(data: Partial<Prenotazione>) {
    if (!editingCard) return;
    aggiorna(editingCard.id, data);
  }

  function salvaInline() {
    if (!editingId) return;
    aggiorna(editingId, {
      ...editValues,
      importo_totale:  Number(editValues.importo_totale)  || 0,
      tassa_soggiorno: editValues.tassa_soggiorno ? Number(editValues.tassa_soggiorno) : undefined,
    });
  }

  function spostaMese(delta: number) {
    const base = startOfMonth(parseISO(filtroDal));
    const nuovoMese = addMonths(base, delta);
    setFiltroDal(format(startOfMonth(nuovoMese), 'yyyy-MM-dd'));
    setFiltroAl(format(endOfMonth(nuovoMese), 'yyyy-MM-dd'));
  }

  const nomiOspiti = Array.from(new Set(prenotazioni.map(p => p.ospite_nome))).sort();

  const daCompletareCount = prenotazioni.filter(daCompletare).length;

  const filtrate = prenotazioni.filter(p => {
    if (filtroStato === 'da_completare') { if (!daCompletare(p)) return false; }
    else if (filtroStato !== 'tutti' && p.stato !== filtroStato) return false;
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
  const filtroModificato = filtroDal !== DEFAULT_DAL || filtroAl !== DEFAULT_AL;

  function checkinBadge(prenId: string, email: string) {
    const s = checkinStatus[prenId];
    if (!s && !email) return null;
    if (s?.alloggiatiCount > 0) {
      return <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold whitespace-nowrap"><Check size={9} /> Documenti caricati</span>;
    }
    if (s?.linkInviato) {
      return <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold whitespace-nowrap">In attesa risposta</span>;
    }
    if (email) {
      return <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium whitespace-nowrap">Email da inviare</span>;
    }
    return null;
  }

  if (loading) return <div className="text-gray-400 py-10 text-center">Caricamento...</div>;

  return (
    <div className="space-y-5">
      {righeSkippate.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm text-amber-800">
          <div className="flex-1">
            <p className="font-medium mb-1">{righeSkippate.length} righe dello sheet non arricchite:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-700">
              {righeSkippate.map((riga, i) => <li key={i}>{riga}</li>)}
            </ul>
          </div>
          <button
            onClick={() => setRigheSkippate([])}
            className="text-amber-500 hover:text-amber-700 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Prenotazioni</h1>
        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className={`hidden sm:inline text-xs px-2 py-1 rounded ${
              syncOk === false ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={syncIcal}
            disabled={syncing}
            className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded text-sm font-medium transition-colors sm:px-4 sm:py-2 ${
              syncOk === true  ? 'border-green-300 bg-green-50 text-green-700' :
              syncOk === false ? 'border-red-300 bg-red-50 text-red-700' :
              'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Sync iCal</span>
          </button>
          <button
            onClick={() => setMostraForm(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-2.5 py-1.5 rounded text-sm font-medium hover:bg-blue-700 sm:px-4 sm:py-2"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Nuova</span>
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
      </div>

      {/* KPI cards desktop */}
      <div className="hidden sm:grid sm:grid-cols-3 gap-4">
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
      <div className="bg-white rounded-lg shadow-sm p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => spostaMese(-1)} className="p-1 rounded hover:bg-gray-100" title="Mese precedente"><ChevronLeft size={16} /></button>
          <div className="flex items-center gap-1">
            <input type="date" value={filtroDal} onChange={e => setFiltroDal(e.target.value)} className="border rounded px-1.5 py-1 text-xs" />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={filtroAl}  onChange={e => setFiltroAl(e.target.value)}  className="border rounded px-1.5 py-1 text-xs" />
          </div>
          <button onClick={() => spostaMese(1)} className="p-1 rounded hover:bg-gray-100" title="Mese successivo"><ChevronRight size={16} /></button>
          {filtroModificato && (
            <button onClick={() => { setFiltroDal(DEFAULT_DAL); setFiltroAl(DEFAULT_AL); }} className="text-xs text-blue-600 hover:underline">
              Reset
            </button>
          )}
          <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)} className="border rounded px-2 py-1 text-xs">
            <option value="tutti">Tutti</option>
            <option value="confermata">Confermata</option>
            <option value="pending">In attesa</option>
            <option value="cancellata">Cancellata</option>
            <option value="da_completare">Da completare{daCompletareCount > 0 ? ` (${daCompletareCount})` : ''}</option>
          </select>
          <select value={filtroCamera} onChange={e => setFiltroCamera(e.target.value)} className="border rounded px-2 py-1 text-xs">
            <option value="tutte">Tutte le camere</option>
            {camere.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <div className="relative">
            <input
              type="text"
              list="ospiti-list"
              value={filtroOspite}
              onChange={e => setFiltroOspite(e.target.value)}
              placeholder="Ospite..."
              className="border rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {filtroOspite && (
              <button
                onClick={() => setFiltroOspite('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
            <datalist id="ospiti-list">
              {nomiOspiti.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <span className="text-xs text-gray-500 ml-auto">{filtrate.length} trovate</span>
        </div>
      </div>

      {/* Modal modifica prenotazione (mobile) */}
      {editingCard && (
        <div
          className="sm:hidden fixed inset-0 z-50 flex items-end bg-black/50"
          onClick={() => setEditingCard(null)}
        >
          <div
            className="bg-white rounded-t-2xl w-full p-5 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-gray-800">Modifica prenotazione</h2>
              <button onClick={() => setEditingCard(null)}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <PrenotazioneForm
              iniziale={editingCard}
              onSalva={aggiornaCard}
              onAnnulla={() => setEditingCard(null)}
            />
          </div>
        </div>
      )}

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
                    <div className="flex items-center gap-2 mb-2.5 pr-16 flex-wrap">
                      <span className="font-bold text-gray-900 text-[15px]">{p.ospite_nome}</span>
                      {(p.fonte === 'ical' || p.fonte === 'booking') && (
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

                    {/* Azioni modifica / elimina */}
                    <div className="absolute top-3 right-3 flex gap-0.5">
                      <button
                        onClick={() => setEditingCard(p)}
                        className="p-1.5 text-gray-400 active:text-blue-600 touch-manipulation rounded-lg active:bg-blue-50"
                      >
                        <Pencil size={17} strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => elimina(p.id)}
                        className="p-1.5 text-gray-400 active:text-red-600 touch-manipulation rounded-lg active:bg-red-50"
                      >
                        <Trash2 size={17} strokeWidth={1.8} />
                      </button>
                    </div>

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
                    {/* Email + check-in status + WhatsApp */}
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      {p.ospite_email && (
                        <div className="flex items-center gap-1.5">
                          <Mail size={13} className="text-gray-400 flex-shrink-0" />
                          <span className="truncate text-blue-600 text-xs">{p.ospite_email}</span>
                        </div>
                      )}
                      {checkinBadge(p.id, p.ospite_email)}
                      {p.ospite_telefono && (
                        <>
                          <button
                            onClick={() => inviaLinkWhatsApp(p.id, p.ospite_telefono)}
                            disabled={invioWA[p.id] === 'loading'}
                            title="Invia link registrazione documenti"
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                              invioWA[p.id] === 'ok' ? 'border-green-300 text-green-700 bg-green-50'
                              : invioWA[p.id] === 'error' ? 'border-red-300 text-red-600'
                              : 'border-green-300 text-green-700 bg-white'
                            }`}
                          >
                            {invioWA[p.id] === 'loading' ? <Loader2 size={10} className="animate-spin" />
                            : invioWA[p.id] === 'ok' ? <><MessageCircle size={10} /> ✓</>
                            : invioWA[p.id] === 'error' ? '✗ WA'
                            : <><MessageCircle size={10} /> Documenti</>}
                          </button>
                          <button
                            onClick={() => inviaIstruzioni(p.id, p.ospite_telefono)}
                            disabled={invioIstr[p.id] === 'loading'}
                            title="Invia istruzioni check-in"
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                              invioIstr[p.id] === 'ok' ? 'border-blue-300 text-blue-700 bg-blue-50'
                              : invioIstr[p.id] === 'error' ? 'border-red-300 text-red-600'
                              : 'border-blue-300 text-blue-700 bg-white'
                            }`}
                          >
                            {invioIstr[p.id] === 'loading' ? <Loader2 size={10} className="animate-spin" />
                            : invioIstr[p.id] === 'ok' ? <><MessageCircle size={10} /> ✓</>
                            : invioIstr[p.id] === 'error' ? '✗'
                            : <><MessageCircle size={10} /> Check-in</>}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Separatore */}
                    <div className="border-t border-gray-100 mt-2.5 pt-2.5 flex items-center justify-between">
                      {/* Camera */}
                      <span className="text-xs text-gray-400">{cam?.nome ?? `Camera ${p.camera_id}`}</span>
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
                <th className="text-center px-3 py-3 font-medium text-gray-600">Check-in</th>
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
                          <input
                            type="email"
                            value={(ev.ospite_email as string) ?? ''}
                            onChange={e => setEV('ospite_email', e.target.value)}
                            className={INPUT + ' text-xs text-blue-500'}
                            placeholder="Email"
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
                        {(p.fonte === 'ical' || p.fonte === 'booking') && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">BK</span>
                        )}
                      </div>
                      {p.ospite_telefono && <div className="text-xs text-gray-400">{p.ospite_telefono}</div>}
                      {p.ospite_email && <div className="text-xs text-blue-500 truncate max-w-[180px]">{p.ospite_email}</div>}
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
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {checkinBadge(p.id, p.ospite_email)}
                        {p.ospite_telefono && (
                          <>
                            <button
                              onClick={() => inviaLinkWhatsApp(p.id, p.ospite_telefono)}
                              disabled={invioWA[p.id] === 'loading'}
                              title="Invia link registrazione documenti"
                              className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                invioWA[p.id] === 'ok' ? 'border-green-300 text-green-700 bg-green-50'
                                : invioWA[p.id] === 'error' ? 'border-red-300 text-red-600'
                                : 'border-green-300 text-green-700 bg-white hover:bg-green-50'
                              }`}
                            >
                              {invioWA[p.id] === 'loading' ? <Loader2 size={10} className="animate-spin" />
                              : invioWA[p.id] === 'ok' ? <><MessageCircle size={10} /> ✓</>
                              : invioWA[p.id] === 'error' ? '✗'
                              : <><MessageCircle size={10} /> Doc</>}
                            </button>
                            <button
                              onClick={() => inviaIstruzioni(p.id, p.ospite_telefono)}
                              disabled={invioIstr[p.id] === 'loading'}
                              title="Invia istruzioni check-in"
                              className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                invioIstr[p.id] === 'ok' ? 'border-blue-300 text-blue-700 bg-blue-50'
                                : invioIstr[p.id] === 'error' ? 'border-red-300 text-red-600'
                                : 'border-blue-300 text-blue-700 bg-white hover:bg-blue-50'
                              }`}
                            >
                              {invioIstr[p.id] === 'loading' ? <Loader2 size={10} className="animate-spin" />
                              : invioIstr[p.id] === 'ok' ? <><MessageCircle size={10} /> ✓</>
                              : invioIstr[p.id] === 'error' ? '✗'
                              : <><MessageCircle size={10} /> Check-in</>}
                            </button>
                          </>
                        )}
                      </div>
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
