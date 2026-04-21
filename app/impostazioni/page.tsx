'use client';

import { useEffect, useState } from 'react';
import { CAMERE, Impostazioni } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { Save, PenLine, Users, Trash2, Plus, KeyRound, Link, Copy, Check, RefreshCw, Table2 } from 'lucide-react';

const DOT_CAMERA: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-400',
  3: 'bg-green-500',
  4: 'bg-gray-400',
  5: 'bg-blue-600',
};

interface UtenteInfo { id: string; username: string; }

interface SyncResult {
  camera_id: number;
  aggiunte: number;
  rimosse: number;
  errore?: string;
}

interface ICalSyncResult {
  ok: boolean;
  risultati: SyncResult[];
  doppioniRimossi: number;
  gmail?: { importate: number; aggiornate: number; cancellate: number; dettagli: string[] };
}

export default function ImpostazioniPage() {
  const camere = useCamere();
  const [imp, setImp] = useState<Impostazioni>({ ical_urls: {}, nomi_camere: {} });
  const [salvatoNomi, setSalvatoNomi] = useState(false);
  const [nomi, setNomi] = useState<Record<number, string>>({});
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [risultatiIcal, setRisultatiIcal] = useState<ICalSyncResult | null>(null);
  const [salvatoUrls, setSalvatoUrls] = useState(false);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [msgSheets, setMsgSheets] = useState('');
  const [utenti, setUtenti] = useState<UtenteInfo[]>([]);
  const [nuovoUsername, setNuovoUsername] = useState('');
  const [nuovaPassword, setNuovaPassword] = useState('');
  const [erroreAccount, setErroreAccount] = useState('');
  const [cambioPasswordId, setCambioPasswordId] = useState<string | null>(null);
  const [nuovaPasswordCambio, setNuovaPasswordCambio] = useState('');
  const [copiato, setCopiato] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const [togglingSheets, setTogglingSheets] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch('/api/impostazioni')
      .then((r) => r.json())
      .then((data) => {
        setImp(data);
        setNomi(data.nomi_camere ?? {});
      });
    caricaUtenti();
  }, []);

  function caricaUtenti() {
    fetch('/api/auth/utenti').then(r => r.json()).then(setUtenti);
  }

  async function copia(cameraId: number) {
    const url = `${origin}/api/ical/${cameraId}`;
    await navigator.clipboard.writeText(url);
    setCopiato(cameraId);
    setTimeout(() => setCopiato(null), 2000);
  }

  async function aggiungiUtente() {
    setErroreAccount('');
    const res = await fetch('/api/auth/utenti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: nuovoUsername, password: nuovaPassword }),
    });
    if (res.ok) {
      setNuovoUsername('');
      setNuovaPassword('');
      caricaUtenti();
    } else {
      const d = await res.json();
      setErroreAccount(d.error);
    }
  }

  async function eliminaUtente(id: string) {
    if (!confirm('Eliminare questo utente?')) return;
    await fetch(`/api/auth/utenti/${id}`, { method: 'DELETE' });
    caricaUtenti();
  }

  async function cambiaPassword(id: string) {
    await fetch(`/api/auth/utenti/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: nuovaPasswordCambio }),
    });
    setCambioPasswordId(null);
    setNuovaPasswordCambio('');
  }

  async function toggleGoogleSheets() {
    setTogglingSheets(true);
    const nuovo = !(imp.google_sheets_abilitato ?? false);
    await fetch('/api/impostazioni', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_sheets_abilitato: nuovo }),
    });
    setImp(prev => ({ ...prev, google_sheets_abilitato: nuovo }));
    setTogglingSheets(false);
  }

  async function salvaNomi() {
    await fetch('/api/impostazioni', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...imp, nomi_camere: nomi }),
    });
    setImp((prev) => ({ ...prev, nomi_camere: nomi }));
    setSalvatoNomi(true);
    setTimeout(() => setSalvatoNomi(false), 2000);
  }

  async function salvaUrls() {
    await fetch('/api/impostazioni', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...imp }),
    });
    setSalvatoUrls(true);
    setTimeout(() => setSalvatoUrls(false), 2000);
  }

  async function sincronizzaIcal() {
    setSyncingIcal(true);
    setRisultatiIcal(null);
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    setRisultatiIcal(data);
    setSyncingIcal(false);
  }

  async function syncSheets(direzione: 'export' | 'import') {
    setSyncingSheets(true);
    setMsgSheets('');
    const res = await fetch('/api/sync-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direzione }),
    });
    const data = await res.json();
    setMsgSheets(data.messaggio ?? data.errore ?? 'Fatto');
    setSyncingSheets(false);
  }

  function setUrl(cameraId: number, url: string) {
    setImp((prev) => ({
      ...prev,
      ical_urls: { ...prev.ical_urls, [cameraId]: url },
    }));
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Impostazioni</h1>

      {/* Rinomina camere */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <PenLine size={18} className="text-purple-600" />
          <h2 className="font-semibold text-gray-700">Rinomina camere</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Assegna un nome personalizzato a ogni camera (es. &quot;Suite&quot;, &quot;Mansarda&quot;, &quot;Piano terra&quot;).
        </p>

        <div className="space-y-3">
          {CAMERE.map((c) => {
            const nomeAttuale = camere.find((cam) => cam.id === c.id)?.nome ?? c.nome;
            return (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-20 flex-shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_CAMERA[c.id] ?? 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-400">Camera {c.id}</span>
                </div>
                <input
                  type="text"
                  placeholder={`Camera ${c.id}`}
                  value={nomi[c.id] ?? ''}
                  onChange={(e) =>
                    setNomi((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
                {nomeAttuale !== `Camera ${c.id}` && !nomi[c.id] && (
                  <span className="text-xs text-gray-400 italic">{nomeAttuale}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={salvaNomi}
            className="flex items-center gap-1.5 bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700"
          >
            <Save size={15} />
            {salvatoNomi ? 'Salvato!' : 'Salva nomi'}
          </button>
          <button
            onClick={() => setNomi({})}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Ripristina predefiniti
          </button>
        </div>
      </div>

      {/* URL iCal Booking.com — import */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Link size={18} className="text-blue-600" />
          <h2 className="font-semibold text-gray-700">URL iCal Booking.com</h2>
        </div>
        <p className="text-sm text-gray-500 mb-1">
          Incolla qui l&apos;URL iCal di ogni camera dall&apos;extranet Booking.com.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          Extranet → Struttura → Disponibilità → Sincronizzazione calendario → Esporta calendario
        </p>

        <div className="space-y-3">
          {CAMERE.map((c) => {
            const nomeAttuale = camere.find((cam) => cam.id === c.id)?.nome ?? c.nome;
            return (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_CAMERA[c.id] ?? 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-600 truncate">{nomeAttuale}</span>
                </div>
                <input
                  type="url"
                  placeholder="https://ical.booking.com/v1/exportiCalendar?..."
                  value={imp.ical_urls?.[c.id] ?? ''}
                  onChange={(e) => setUrl(c.id, e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-xs font-mono text-gray-600"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={salvaUrls}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            <Save size={15} />
            {salvatoUrls ? 'Salvato!' : 'Salva URL'}
          </button>
          <button
            onClick={sincronizzaIcal}
            disabled={syncingIcal}
            className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <RefreshCw size={15} className={syncingIcal ? 'animate-spin' : ''} />
            {syncingIcal ? 'Sincronizzando...' : 'Sync iCal ora'}
          </button>
        </div>

        {risultatiIcal && (
          <div className="mt-3 space-y-1">
            {risultatiIcal.risultati.map((r) => {
              const cam = camere.find(c => c.id === r.camera_id);
              return (
                <div key={r.camera_id} className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 ${
                  r.errore ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                }`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_CAMERA[r.camera_id] ?? 'bg-gray-400'}`} />
                  <span>{cam?.nome ?? `Camera ${r.camera_id}`}:</span>
                  {r.errore
                    ? <span>{r.errore}</span>
                    : <span>+{r.aggiunte} aggiunte, -{r.rimosse} rimosse</span>
                  }
                </div>
              );
            })}
            {risultatiIcal.doppioniRimossi > 0 && (
              <div className="text-xs px-3 py-1 text-gray-500">
                {risultatiIcal.doppioniRimossi} doppio/i rimosso/i
              </div>
            )}
            {risultatiIcal.gmail && (risultatiIcal.gmail.importate > 0 || risultatiIcal.gmail.aggiornate > 0 || risultatiIcal.gmail.cancellate > 0) && (
              <div className="text-xs px-3 py-1.5 rounded bg-blue-50 text-blue-700 mt-1">
                Gmail: {[
                  risultatiIcal.gmail.importate > 0 && `${risultatiIcal.gmail.importate} nuove`,
                  risultatiIcal.gmail.aggiornate > 0 && `${risultatiIcal.gmail.aggiornate} aggiornate`,
                  risultatiIcal.gmail.cancellate > 0 && `${risultatiIcal.gmail.cancellate} cancellate`,
                ].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Google Sheets */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Table2 size={18} className="text-emerald-600" />
            <h2 className="font-semibold text-gray-700">Google Sheets</h2>
          </div>
          <button
            onClick={toggleGoogleSheets}
            disabled={togglingSheets}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              imp.google_sheets_abilitato ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              imp.google_sheets_abilitato ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          {imp.google_sheets_abilitato
            ? 'Integrazione Google Sheets attiva — i pulsanti di import/export sono visibili in tutta l\'app.'
            : 'Integrazione Google Sheets disabilitata — l\'app funziona solo con iCal e inserimenti manuali.'}
        </p>

        {imp.google_sheets_abilitato && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => syncSheets('export')}
                disabled={syncingSheets}
                className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                <RefreshCw size={15} className={syncingSheets ? 'animate-spin' : ''} />
                Esporta su Sheets
              </button>
              <button
                onClick={() => syncSheets('import')}
                disabled={syncingSheets}
                className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                <RefreshCw size={15} className={syncingSheets ? 'animate-spin' : ''} />
                Importa da Sheets
              </button>
            </div>

            {msgSheets && (
              <div className={`mt-3 text-sm px-3 py-2 rounded ${
                msgSheets.includes('Errore') || msgSheets.includes('errore')
                  ? 'bg-red-50 text-red-700'
                  : 'bg-emerald-50 text-emerald-700'
              }`}>
                {msgSheets}
              </div>
            )}
          </>
        )}
      </div>

      {/* iCal Output */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Link size={18} className="text-green-600" />
          <h2 className="font-semibold text-gray-700">iCal Output — Blocca date su Booking.com</h2>
        </div>
        <p className="text-sm text-gray-500 mb-1">
          Queste URL espongono le prenotazioni inserite manualmente sull&apos;app. Aggiungile su Booking.com per bloccare automaticamente le date.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          Extranet Booking.com → Proprietà → Disponibilità → Sincronizzazione calendario → Importa calendario
        </p>

        <div className="space-y-2">
          {CAMERE.map((c) => {
            const nomeAttuale = camere.find((cam) => cam.id === c.id)?.nome ?? c.nome;
            const url = origin ? `${origin}/api/ical/${c.id}` : `…/api/ical/${c.id}`;
            return (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-24 flex-shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_CAMERA[c.id] ?? 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-600 truncate">{nomeAttuale}</span>
                </div>
                <code className="flex-1 text-xs bg-gray-50 border rounded px-3 py-2 text-gray-600 truncate">
                  {url}
                </code>
                <button
                  onClick={() => copia(c.id)}
                  title="Copia URL"
                  className={`flex items-center gap-1 px-2 py-2 rounded text-xs font-medium transition-colors flex-shrink-0 ${
                    copiato === c.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {copiato === c.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gestione account */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users size={18} className="text-indigo-600" />
          <h2 className="font-semibold text-gray-700">Gestione account</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Utenti autorizzati ad accedere all&apos;applicazione.
        </p>

        <div className="space-y-2 mb-5">
          {utenti.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 bg-gray-50">
              <span className="flex-1 text-sm font-medium text-gray-800">{u.username}</span>

              {cambioPasswordId === u.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder="Nuova password"
                    value={nuovaPasswordCambio}
                    onChange={e => setNuovaPasswordCambio(e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => cambiaPassword(u.id)}
                    disabled={!nuovaPasswordCambio}
                    className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-40"
                  >
                    Salva
                  </button>
                  <button
                    onClick={() => { setCambioPasswordId(null); setNuovaPasswordCambio(''); }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Annulla
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCambioPasswordId(u.id)}
                  title="Cambia password"
                  className="text-gray-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50"
                >
                  <KeyRound size={15} />
                </button>
              )}

              <button
                onClick={() => eliminaUtente(u.id)}
                title="Elimina utente"
                className="text-gray-300 hover:text-red-600 p-1 rounded hover:bg-red-50"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t pt-4">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Aggiungi utente</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Username"
              value={nuovoUsername}
              onChange={e => setNuovoUsername(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <input
              type="password"
              placeholder="Password"
              value={nuovaPassword}
              onChange={e => setNuovaPassword(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <button
              onClick={aggiungiUtente}
              disabled={!nuovoUsername || !nuovaPassword}
              className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              <Plus size={14} /> Aggiungi
            </button>
          </div>
          {erroreAccount && <p className="text-xs text-red-600 mt-2">{erroreAccount}</p>}
        </div>
      </div>

    </div>
  );
}
