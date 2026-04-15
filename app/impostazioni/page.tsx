'use client';

import { useEffect, useState } from 'react';
import { CAMERE, Impostazioni } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { RefreshCw, Save, Link, CheckCircle, AlertCircle, Download, PenLine, Users, Trash2, Plus, KeyRound } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

interface UtenteInfo { id: string; username: string; }

interface SyncResult {
  camera_id: number;
  aggiunte: number;
  rimosse: number;
  errore?: string;
}

export default function ImpostazioniPage() {
  const camere = useCamere();
  const [imp, setImp] = useState<Impostazioni>({ ical_urls: {}, nomi_camere: {} });
  const [salvato, setSalvato] = useState(false);
  const [salvatoNomi, setSalvatoNomi] = useState(false);
  const [nomi, setNomi] = useState<Record<number, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [risultatiSync, setRisultatiSync] = useState<SyncResult[] | null>(null);
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

  async function salva() {
    await fetch('/api/impostazioni', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imp),
    });
    setSalvato(true);
    setTimeout(() => setSalvato(false), 2000);
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

  async function sincronizza() {
    setSyncing(true);
    setRisultatiSync(null);
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    setRisultatiSync(data.risultati);
    setSyncing(false);
    fetch('/api/impostazioni').then((r) => r.json()).then(setImp);
  }

  function setUrl(cameraId: number, url: string) {
    setImp((prev) => ({
      ...prev,
      ical_urls: { ...prev.ical_urls, [cameraId]: url },
    }));
  }

  const haAlmenoUnUrl = Object.values(imp.ical_urls).some((u) => u && u.trim());

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
                <span className="text-sm text-gray-400 w-20 flex-shrink-0">
                  Camera {c.id}
                </span>
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

      {/* IMPORT: Booking.com → App */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Download size={18} className="text-blue-600" />
          <h2 className="font-semibold text-gray-700">
            Import iCal — Booking.com → App
          </h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Incolla l&apos;URL iCal da Booking.com per ogni camera.{' '}
          <strong>Extranet → Calendario → Sincronizza → Esporta</strong>
        </p>

        <div className="space-y-3">
          {CAMERE.map((camera) => (
            <div key={camera.id}>
              <label className="block text-xs font-medium text-gray-500 mb-0.5">
                {camera.nome}
              </label>
              <input
                type="url"
                placeholder="https://admin.booking.com/hotel/hoteladmin/ical.html?t=..."
                value={imp.ical_urls[camera.id] ?? ''}
                onChange={(e) => setUrl(camera.id, e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={salva}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            <Save size={15} />
            {salvato ? 'Salvato!' : 'Salva URL'}
          </button>

          <button
            onClick={sincronizza}
            disabled={syncing || !haAlmenoUnUrl}
            className="flex items-center gap-1.5 border border-gray-300 px-4 py-2 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizzazione...' : 'Sincronizza ora'}
          </button>

          {imp.ultimo_sync && (
            <span className="text-xs text-gray-400">
              Ultima:{' '}
              {formatDistanceToNow(parseISO(imp.ultimo_sync), { addSuffix: true, locale: it })}
            </span>
          )}
        </div>

        {risultatiSync && (
          <div className="mt-3 space-y-1.5">
            {risultatiSync.map((r) => {
              const camera = CAMERE.find((c) => c.id === r.camera_id);
              return (
                <div
                  key={r.camera_id}
                  className={`flex items-center gap-2 text-sm px-3 py-2 rounded ${
                    r.errore ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {r.errore ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                  <span className="font-medium">{camera?.nome}:</span>
                  {r.errore ? <span>{r.errore}</span> : (
                    <span>{r.aggiunte} aggiunta/e, {r.rimosse} rimossa/e</span>
                  )}
                </div>
              );
            })}
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

      {/* Guida completa */}
      <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800 space-y-3">
        <div>
          <div className="font-semibold mb-1">Come aggiungere l&apos;URL dell&apos;app su Booking.com:</div>
          <ol className="list-decimal list-inside space-y-1">
            <li>Accedi a <strong>extranet.booking.com</strong></li>
            <li>Vai su <strong>Calendario → Sincronizza calendario</strong></li>
            <li>Seleziona <strong>Importa calendario</strong></li>
            <li>Incolla l&apos;URL iCal della camera (sezione Export sopra)</li>
            <li>Booking.com sincronizzerà il calendario ogni 2–6 ore</li>
          </ol>
        </div>
        <div className="flex items-start gap-2">
          <Link size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Per usare in locale, esponi l&apos;app con{' '}
            <code className="bg-blue-100 px-1 rounded">npx ngrok http 3000</code>{' '}
            e usa l&apos;URL generato da ngrok.
          </span>
        </div>
      </div>
    </div>
  );
}
