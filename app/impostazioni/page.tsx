'use client';

import { useEffect, useState } from 'react';
import { CAMERE, Impostazioni } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { RefreshCw, Save, CheckCircle, PenLine, Users, Trash2, Plus, KeyRound, Mail, Link } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

const DOT_CAMERA: Record<number, string> = {
  1: 'bg-red-500',   // Rossa
  2: 'bg-amber-400', // Gialla
  3: 'bg-green-500', // Verde
  4: 'bg-gray-400',  // Bianca
  5: 'bg-blue-600',  // Blue
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
}

export default function ImpostazioniPage() {
  const camere = useCamere();
  const [imp, setImp] = useState<Impostazioni>({ ical_urls: {}, nomi_camere: {} });
  const [salvatoNomi, setSalvatoNomi] = useState(false);
  const [nomi, setNomi] = useState<Record<number, string>>({});
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [risultatiIcal, setRisultatiIcal] = useState<ICalSyncResult | null>(null);
  const [salvatoUrls, setSalvatoUrls] = useState(false);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [risultatiGmail, setRisultatiGmail] = useState<{ importate: number; dettagli: string[] } | null>(null);
  const [utenti, setUtenti] = useState<UtenteInfo[]>([]);
  const [nuovoUsername, setNuovoUsername] = useState('');
  const [nuovaPassword, setNuovaPassword] = useState('');
  const [erroreAccount, setErroreAccount] = useState('');
  const [cambioPasswordId, setCambioPasswordId] = useState<string | null>(null);
  const [nuovaPasswordCambio, setNuovaPasswordCambio] = useState('');

  useEffect(() => {
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

  async function sincronizzaGmail() {
    setSyncingGmail(true);
    setRisultatiGmail(null);
    const res = await fetch('/api/sync-gmail', { method: 'POST' });
    const data = await res.json();
    setRisultatiGmail(data);
    setSyncingGmail(false);
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

      {/* URL iCal Booking.com */}
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
          </div>
        )}
      </div>

      {/* Sync Gmail — Booking.com → App */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={18} className="text-red-500" />
          <h2 className="font-semibold text-gray-700">Sync Gmail — Booking.com</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Importa automaticamente le prenotazioni dalle email di conferma Booking.com
          ricevute su <strong>giuadelcasapalermo@gmail.com</strong>.
        </p>

        <button
          onClick={sincronizzaGmail}
          disabled={syncingGmail}
          className="flex items-center gap-1.5 bg-red-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-red-600 disabled:opacity-50"
        >
          <RefreshCw size={15} className={syncingGmail ? 'animate-spin' : ''} />
          {syncingGmail ? 'Lettura email...' : 'Importa da Gmail'}
        </button>

        {risultatiGmail && (
          <div className={`mt-3 text-sm px-3 py-2 rounded ${
            risultatiGmail.importate > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'
          }`}>
            <div className="flex items-center gap-2 font-medium mb-1">
              <CheckCircle size={14} />
              {risultatiGmail.importate > 0
                ? `${risultatiGmail.importate} prenotazion${risultatiGmail.importate === 1 ? 'e' : 'i'} importata/e`
                : 'Nessuna nuova prenotazione'}
            </div>
            {risultatiGmail.dettagli?.map((d, i) => (
              <div key={i} className="text-xs opacity-80 ml-5">{d}</div>
            ))}
          </div>
        )}
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

        {/* Lista utenti */}
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

        {/* Aggiungi utente */}
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
