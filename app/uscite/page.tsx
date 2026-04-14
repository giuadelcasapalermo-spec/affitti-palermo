'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Uscita, CATEGORIE_USCITA, CategoriaUscita,
  Entrata, CATEGORIE_ENTRATA, CategoriaEntrata,
} from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { fData } from '@/lib/utils';
import { Plus, Pencil, Trash2, X, TrendingDown, TrendingUp, ChevronDown } from 'lucide-react';

/* ── colori ───────────────────────────────────────────── */
const COL_USCITA: Record<CategoriaUscita, string> = {
  Pulizie:      'bg-blue-100 text-blue-700',
  Utenze:       'bg-yellow-100 text-yellow-700',
  Manutenzione: 'bg-orange-100 text-orange-700',
  Forniture:    'bg-green-100 text-green-700',
  Arredamento:  'bg-cyan-100 text-cyan-700',
  Commissioni:  'bg-purple-100 text-purple-700',
  Pubblicità:   'bg-pink-100 text-pink-700',
  Affitto:      'bg-indigo-100 text-indigo-700',
  Tasse:        'bg-red-100 text-red-700',
  Altro:        'bg-gray-100 text-gray-600',
};
const COL_ENTRATA: Record<CategoriaEntrata, string> = {
  'Booking.com': 'bg-blue-100 text-blue-700',
  'Airbnb':      'bg-red-100 text-red-700',
  'Privato':     'bg-green-100 text-green-700',
  'Altro':       'bg-gray-100 text-gray-600',
};

const oggi = new Date().toISOString().split('T')[0];

/* ── riga unificata ───────────────────────────────────── */
type Riga =
  | { tipo: 'entrata'; rec: Entrata }
  | { tipo: 'uscita';  rec: Uscita  };

/* ── Form uscita ──────────────────────────────────────── */
function FormUscita({ iniziale, onSalva, onAnnulla, camere }: {
  iniziale?: Partial<Uscita>;
  onSalva: (d: Partial<Uscita>) => void;
  onAnnulla: () => void;
  camere: { id: number; nome: string }[];
}) {
  const [f, setF] = useState({
    data:       iniziale?.data       ?? oggi,
    descrizione:iniziale?.descrizione ?? '',
    categoria:  iniziale?.categoria  ?? 'Altro' as CategoriaUscita,
    importo:    iniziale?.importo    ?? '',
    camera_id:  iniziale?.camera_id  ?? '',
    note:       iniziale?.note       ?? '',
  });
  const set = (k: string, v: string | number) => setF(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSalva({ ...f, importo: Number(f.importo), camera_id: f.camera_id ? Number(f.camera_id) : undefined }); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Data *</label>
          <input type="date" value={f.data} onChange={e => set('data', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Categoria *</label>
          <select value={f.categoria} onChange={e => set('categoria', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required>
            {CATEGORIE_USCITA.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Descrizione *</label>
        <input type="text" value={f.descrizione} onChange={e => set('descrizione', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Importo (€) *</label>
          <input type="number" min="0" step="0.01" value={f.importo} onChange={e => set('importo', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Camera</label>
          <select value={f.camera_id} onChange={e => set('camera_id', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
            <option value="">Generale</option>
            {camere.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></div>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
        <textarea value={f.note} onChange={e => set('note', e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" /></div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onAnnulla} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Annulla</button>
        <button type="submit" className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">Salva uscita</button>
      </div>
    </form>
  );
}

/* ── Form entrata ─────────────────────────────────────── */
function FormEntrata({ iniziale, onSalva, onAnnulla, camere }: {
  iniziale?: Partial<Entrata>;
  onSalva: (d: Partial<Entrata>) => void;
  onAnnulla: () => void;
  camere: { id: number; nome: string }[];
}) {
  const [f, setF] = useState({
    data:       iniziale?.data        ?? oggi,
    descrizione:iniziale?.descrizione ?? '',
    categoria:  iniziale?.categoria   ?? 'Altro' as CategoriaEntrata,
    importo:    iniziale?.importo     ?? '',
    camera_id:  iniziale?.camera_id   ?? '',
    note:       iniziale?.note        ?? '',
  });
  const set = (k: string, v: string | number) => setF(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSalva({ ...f, importo: Number(f.importo), camera_id: f.camera_id ? Number(f.camera_id) : undefined }); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Data *</label>
          <input type="date" value={f.data} onChange={e => set('data', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Fonte *</label>
          <select value={f.categoria} onChange={e => set('categoria', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required>
            {CATEGORIE_ENTRATA.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Descrizione *</label>
        <input type="text" value={f.descrizione} onChange={e => set('descrizione', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="es. Incasso Rossi" required /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Importo (€) *</label>
          <input type="number" min="0" step="0.01" value={f.importo} onChange={e => set('importo', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Camera</label>
          <select value={f.camera_id} onChange={e => set('camera_id', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
            <option value="">Generale</option>
            {camere.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></div>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
        <textarea value={f.note} onChange={e => set('note', e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" /></div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onAnnulla} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Annulla</button>
        <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Salva entrata</button>
      </div>
    </form>
  );
}

/* ── Pagina ───────────────────────────────────────────── */
export default function PrimaNotaPage() {
  const camere = useCamere();
  const [entrate, setEntrate] = useState<Entrata[]>([]);
  const [uscite, setUscite]   = useState<Uscita[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAperto, setFormAperto] = useState<'entrata' | 'uscita' | null>(null);
  const [editingE, setEditingE] = useState<Entrata | null>(null);
  const [editingU, setEditingU] = useState<Uscita | null>(null);
  const [filtroMese, setFiltroMese] = useState(() => oggi.slice(0, 7));
  const [filtriFiltriAperti, setFiltriFiltriAperti] = useState(false);
  const [filtroE, setFiltroE] = useState<Set<string>>(new Set(CATEGORIE_ENTRATA));
  const [filtroU, setFiltroU] = useState<Set<string>>(new Set(CATEGORIE_USCITA));

  function toggleCatE(cat: string) {
    setFiltroE(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s; });
  }
  function toggleCatU(cat: string) {
    setFiltroU(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s; });
  }
  const tuttiE = filtroE.size === CATEGORIE_ENTRATA.length;
  const tuttiU = filtroU.size === CATEGORIE_USCITA.length;
  const filtroAttivo = !tuttiE || !tuttiU;

  const carica = useCallback(() => {
    Promise.all([
      fetch('/api/entrate').then(r => r.json()),
      fetch('/api/uscite').then(r => r.json()),
    ]).then(([e, u]) => {
      setEntrate(e as Entrata[]);
      setUscite(u as Uscita[]);
      setLoading(false);
    });
  }, []);

  useEffect(() => { carica(); }, [carica]);

  /* CRUD */
  async function creaEntrata(d: Partial<Entrata>) {
    await fetch('/api/entrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    setFormAperto(null); carica();
  }
  async function aggiornaEntrata(id: string, d: Partial<Entrata>) {
    await fetch(`/api/entrate/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    setEditingE(null); carica();
  }
  async function eliminaEntrata(id: string) {
    if (!confirm('Eliminare questa entrata?')) return;
    await fetch(`/api/entrate/${id}`, { method: 'DELETE' }); carica();
  }
  async function creaUscita(d: Partial<Uscita>) {
    await fetch('/api/uscite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    setFormAperto(null); carica();
  }
  async function aggiornaUscita(id: string, d: Partial<Uscita>) {
    await fetch(`/api/uscite/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    setEditingU(null); carica();
  }
  async function eliminaUscita(id: string) {
    if (!confirm('Eliminare questa uscita?')) return;
    await fetch(`/api/uscite/${id}`, { method: 'DELETE' }); carica();
  }

  /* Lista unificata ordinata per data desc */
  const righe: Riga[] = [
    ...entrate.filter(e => e.data.startsWith(filtroMese) && filtroE.has(e.categoria)).map(e => ({ tipo: 'entrata' as const, rec: e })),
    ...uscite.filter(u => u.data.startsWith(filtroMese) && filtroU.has(u.categoria)).map(u => ({ tipo: 'uscita' as const, rec: u })),
  ].sort((a, b) => b.rec.data.localeCompare(a.rec.data));

  /* KPI */
  const totEntrate = righe.filter(r => r.tipo === 'entrata').reduce((s, r) => s + r.rec.importo, 0);
  const totUscite  = righe.filter(r => r.tipo === 'uscita').reduce((s, r) => s + r.rec.importo, 0);
  const saldo      = totEntrate - totUscite;

  /* Saldo progressivo (dalla più vecchia alla più recente, poi invertiamo per display) */
  const righeCrono = [...righe].reverse();
  let saldoCorrente = 0;
  const saldoMap = new Map<string, number>();
  for (const r of righeCrono) {
    saldoCorrente += r.tipo === 'entrata' ? r.rec.importo : -r.rec.importo;
    saldoMap.set(r.rec.id, saldoCorrente);
  }

  if (loading) return <div className="text-gray-400 py-10 text-center">Caricamento...</div>;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Prima Nota</h1>
        <div className="flex items-center gap-2">
          <input type="month" value={filtroMese} onChange={e => setFiltroMese(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-28 sm:w-auto" />
          <button
            onClick={() => setFormAperto(f => f === 'entrata' ? null : 'entrata')}
            className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700"
          >
            <Plus size={15} /> Entrata
          </button>
          <button
            onClick={() => setFormAperto(f => f === 'uscita' ? null : 'uscita')}
            className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-red-700"
          >
            <Plus size={15} /> Uscita
          </button>
        </div>
      </div>

      {/* KPI mobile compatto */}
      <div className="sm:hidden bg-white rounded-lg shadow-sm px-4 py-3 grid grid-cols-3 divide-x divide-gray-100">
        <div className="text-center">
          <div className="text-[11px] text-gray-400 uppercase tracking-wide">Entrate</div>
          <div className="text-base font-bold text-green-700">+€{totEntrate.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400 uppercase tracking-wide">Uscite</div>
          <div className="text-base font-bold text-red-600">-€{totUscite.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] text-gray-400 uppercase tracking-wide">Saldo</div>
          <div className={`text-base font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-700'}`}>{saldo >= 0 ? '+' : ''}€{saldo.toFixed(0)}</div>
        </div>
      </div>

      {/* KPI desktop */}
      <div className="hidden sm:grid sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-green-100 rounded-full p-2"><TrendingUp size={20} className="text-green-600" /></div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Entrate</div>
            <div className="text-xl font-bold text-green-700">+€{totEntrate.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="bg-red-100 rounded-full p-2"><TrendingDown size={20} className="text-red-600" /></div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Uscite</div>
            <div className="text-xl font-bold text-red-600">-€{totUscite.toFixed(2)}</div>
          </div>
        </div>
        <div className={`rounded-lg shadow-sm p-4 flex items-center gap-3 ${saldo >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className={`rounded-full p-2 ${saldo >= 0 ? 'bg-green-200' : 'bg-red-200'}`}>
            {saldo >= 0 ? <TrendingUp size={20} className="text-green-700" /> : <TrendingDown size={20} className="text-red-700" />}
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Saldo</div>
            <div className={`text-xl font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {saldo >= 0 ? '+' : ''}€{saldo.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Filtro categorie */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <button
          onClick={() => setFiltriFiltriAperti(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtro categorie</span>
            {filtroAttivo && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium">attivo</span>}
          </div>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${filtriFiltriAperti ? 'rotate-180' : ''}`} />
        </button>

        {filtriFiltriAperti && (
          <div className="px-4 pb-4 space-y-2.5 border-t border-gray-100">
            <div className="flex justify-end pt-2">
              {filtroAttivo && (
                <button
                  onClick={() => { setFiltroE(new Set(CATEGORIE_ENTRATA)); setFiltroU(new Set(CATEGORIE_USCITA)); }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Seleziona tutti
                </button>
              )}
            </div>

            {/* Entrate */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 w-14 shrink-0">Entrate</span>
              <button
                onClick={() => setFiltroE(tuttiE ? new Set() : new Set(CATEGORIE_ENTRATA))}
                className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${tuttiE ? 'border-gray-300 text-gray-500 hover:bg-gray-50' : 'border-blue-400 text-blue-600 bg-blue-50'}`}
              >
                {tuttiE ? 'Deseleziona tutti' : 'Seleziona tutti'}
              </button>
              {CATEGORIE_ENTRATA.map(cat => {
                const attivo = filtroE.has(cat);
                return (
                  <button key={cat} onClick={() => toggleCatE(cat)}
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium transition-opacity ${attivo ? COL_ENTRATA[cat] : 'bg-gray-100 text-gray-400 line-through'}`}
                  >{cat}</button>
                );
              })}
            </div>

            {/* Uscite */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 w-14 shrink-0">Uscite</span>
              <button
                onClick={() => setFiltroU(tuttiU ? new Set() : new Set(CATEGORIE_USCITA))}
                className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${tuttiU ? 'border-gray-300 text-gray-500 hover:bg-gray-50' : 'border-blue-400 text-blue-600 bg-blue-50'}`}
              >
                {tuttiU ? 'Deseleziona tutti' : 'Seleziona tutti'}
              </button>
              {CATEGORIE_USCITA.map(cat => {
                const attivo = filtroU.has(cat);
                return (
                  <button key={cat} onClick={() => toggleCatU(cat)}
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium transition-opacity ${attivo ? COL_USCITA[cat] : 'bg-gray-100 text-gray-400 line-through'}`}
                  >{cat}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Form nuova entrata */}
      {formAperto === 'entrata' && (
        <div className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-green-500">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Nuova entrata</h2>
            <button onClick={() => setFormAperto(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <FormEntrata onSalva={creaEntrata} onAnnulla={() => setFormAperto(null)} camere={camere} />
        </div>
      )}

      {/* Form nuova uscita */}
      {formAperto === 'uscita' && (
        <div className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-red-500">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Nuova uscita</h2>
            <button onClick={() => setFormAperto(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <FormUscita onSalva={creaUscita} onAnnulla={() => setFormAperto(null)} camere={camere} />
        </div>
      )}

      {/* Form modifica */}
      {editingE && (
        <div className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-yellow-400">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Modifica entrata</h2>
            <button onClick={() => setEditingE(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <FormEntrata iniziale={editingE} onSalva={d => aggiornaEntrata(editingE.id, d)} onAnnulla={() => setEditingE(null)} camere={camere} />
        </div>
      )}
      {editingU && (
        <div className="bg-white rounded-lg shadow-sm p-5 border-l-4 border-yellow-400">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Modifica uscita</h2>
            <button onClick={() => setEditingU(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
          <FormUscita iniziale={editingU} onSalva={d => aggiornaUscita(editingU.id, d)} onAnnulla={() => setEditingU(null)} camere={camere} />
        </div>
      )}

      {/* Lista unificata — mobile */}
      <div className="sm:hidden bg-white rounded-lg shadow-sm divide-y divide-gray-100">
        {righe.length === 0 ? (
          <div className="text-center text-gray-400 py-10">Nessun movimento registrato</div>
        ) : (
          <>
            {righe.map(r => {
              const s = saldoMap.get(r.rec.id) ?? 0;
              const isE = r.tipo === 'entrata';
              const e = r.rec as Entrata;
              const u = r.rec as Uscita;
              return (
                <div key={r.rec.id} className={`flex items-center gap-2 px-3 py-2 border-l-2 ${isE ? 'border-l-green-400' : 'border-l-red-400'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{fData(r.rec.data)}</span>
                      {isE
                        ? <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ${COL_ENTRATA[e.categoria]}`}>{e.categoria}</span>
                        : <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ${COL_USCITA[u.categoria]}`}>{u.categoria}</span>
                      }
                    </div>
                    <div className="text-xs font-medium text-gray-800 truncate">{r.rec.descrizione}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold ${isE ? 'text-green-700' : 'text-red-600'}`}>
                      {isE ? '+' : '-'}€{r.rec.importo.toFixed(2)}
                    </div>
                    <div className={`text-[10px] font-medium ${s >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {s >= 0 ? '+' : ''}€{s.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => isE ? setEditingE(e) : setEditingU(u)} className="text-gray-300 hover:text-blue-600"><Pencil size={13} /></button>
                    <button onClick={() => isE ? eliminaEntrata(e.id) : eliminaUscita(u.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between px-3 py-2 bg-gray-50 text-xs font-semibold">
              <span className="text-gray-600">Totale mese</span>
              <div className="flex gap-3">
                <span className="text-green-700">+€{totEntrate.toFixed(2)}</span>
                <span className="text-red-600">-€{totUscite.toFixed(2)}</span>
                <span className={saldo >= 0 ? 'text-green-700' : 'text-red-700'}>{saldo >= 0 ? '+' : ''}€{saldo.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Lista unificata — desktop */}
      <div className="hidden sm:block bg-white rounded-lg shadow-sm overflow-x-auto">
        {righe.length === 0 ? (
          <div className="text-center text-gray-400 py-12">Nessun movimento registrato</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Data</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Descrizione</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Categoria</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Entrata</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Uscita</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Saldo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {righe.map(r => {
                const s = saldoMap.get(r.rec.id) ?? 0;
                const isE = r.tipo === 'entrata';
                const e = r.rec as Entrata;
                const u = r.rec as Uscita;
                return (
                  <tr key={r.rec.id} className={`border-b hover:bg-gray-50 ${isE ? 'border-l-2 border-l-green-300' : 'border-l-2 border-l-red-300'}`}>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fData(r.rec.data)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{r.rec.descrizione}</div>
                      {r.rec.note && <div className="text-xs text-gray-400">{r.rec.note}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {isE
                        ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COL_ENTRATA[e.categoria]}`}>{e.categoria}</span>
                        : <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COL_USCITA[u.categoria]}`}>{u.categoria}</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{isE ? `+€${r.rec.importo.toFixed(2)}` : ''}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{!isE ? `-€${r.rec.importo.toFixed(2)}` : ''}</td>
                    <td className={`px-4 py-3 text-right font-bold ${s >= 0 ? 'text-green-700' : 'text-red-700'}`}>{s >= 0 ? '+' : ''}€{s.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => isE ? setEditingE(e) : setEditingU(u)} className="text-gray-400 hover:text-blue-600"><Pencil size={15} /></button>
                        <button onClick={() => isE ? eliminaEntrata(e.id) : eliminaUscita(u.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 font-semibold">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-gray-600">Totale mese</td>
                <td className="px-4 py-3 text-right text-green-700">+€{totEntrate.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-red-600">-€{totUscite.toFixed(2)}</td>
                <td className={`px-4 py-3 text-right font-bold ${saldo >= 0 ? 'text-green-700' : 'text-red-700'}`}>{saldo >= 0 ? '+' : ''}€{saldo.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
