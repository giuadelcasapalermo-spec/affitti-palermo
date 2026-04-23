'use client';

import { useState } from 'react';
import { Camera, Prenotazione } from '@/lib/types';
import { useCamere } from '@/hooks/useCamere';
import { differenceInDays, parseISO } from 'date-fns';
import VoiceInput from './VoiceInput';

interface Props {
  iniziale?: Partial<Prenotazione>;
  onSalva: (data: Partial<Prenotazione>) => void;
  onAnnulla: () => void;
}

export default function PrenotazioneForm({ iniziale = {}, onSalva, onAnnulla }: Props) {
  const oggi = new Date().toISOString().split('T')[0];
  const camere = useCamere();

  const [form, setForm] = useState({
    camera_id: iniziale.camera_id ?? 1,
    ospite_nome: iniziale.ospite_nome ?? '',
    ospite_telefono: iniziale.ospite_telefono ?? '',
    ospite_email: iniziale.ospite_email ?? '',
    check_in: iniziale.check_in ?? oggi,
    check_out: iniziale.check_out ?? oggi,
    importo_totale: iniziale.importo_totale ?? 0,
    tassa_soggiorno: iniziale.tassa_soggiorno ?? 0,
    stato: iniziale.stato ?? 'confermata',
    note: iniziale.note ?? '',
  });

  const notti = differenceInDays(parseISO(form.check_out), parseISO(form.check_in));
  const camera = camere.find((c: Camera) => c.id === form.camera_id);
  const suggerito = notti > 0 && camera ? notti * camera.prezzo_notte : 0;

  function set(k: string, v: string | number) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Partial<Prenotazione> = {
      ...form,
      importo_totale: Number(form.importo_totale),
      tassa_soggiorno: Number(form.tassa_soggiorno) || undefined,
    };
    onSalva(payload);
  }

  function applicaVoce(data: Record<string, unknown>) {
    setForm(f => ({
      ...f,
      ...(data.camera_id != null     ? { camera_id:      Number(data.camera_id) }                    : {}),
      ...(data.ospite_nome           ? { ospite_nome:     String(data.ospite_nome) }                  : {}),
      ...(data.ospite_telefono       ? { ospite_telefono: String(data.ospite_telefono) }              : {}),
      ...(data.ospite_email          ? { ospite_email:    String(data.ospite_email) }                 : {}),
      ...(data.check_in              ? { check_in:        String(data.check_in) }                     : {}),
      ...(data.check_out             ? { check_out:       String(data.check_out) }                    : {}),
      ...(data.importo_totale != null ? { importo_totale: Number(data.importo_totale) }               : {}),
      ...(data.tassa_soggiorno != null ? { tassa_soggiorno: Number(data.tassa_soggiorno) }            : {}),
      ...(data.stato                 ? { stato: data.stato as Prenotazione['stato'] }                 : {}),
      ...(data.note != null          ? { note:            String(data.note) }                         : {}),
    }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <VoiceInput tipo="prenotazione" camere={camere} onParsed={applicaVoce} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Camera *</label>
          <select
            value={form.camera_id}
            onChange={(e) => set('camera_id', Number(e.target.value))}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          >
            {camere.map((c: Camera) => (
              <option key={c.id} value={c.id}>
                {c.nome} — €{c.prezzo_notte}/notte
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stato</label>
          <select
            value={form.stato}
            onChange={(e) => set('stato', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="confermata">Confermata</option>
            <option value="pending">In attesa</option>
            <option value="cancellata">Cancellata</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome ospite *</label>
        <input
          type="text"
          value={form.ospite_nome}
          onChange={(e) => set('ospite_nome', e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
          <input
            type="tel"
            value={form.ospite_telefono}
            onChange={(e) => set('ospite_telefono', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={form.ospite_email}
            onChange={(e) => set('ospite_email', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Check-in *</label>
          <input
            type="date"
            value={form.check_in}
            onChange={(e) => set('check_in', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Check-out *</label>
          <input
            type="date"
            value={form.check_out}
            onChange={(e) => set('check_out', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Importo totale (€)
            {suggerito > 0 && (
              <button
                type="button"
                onClick={() => set('importo_totale', suggerito)}
                className="ml-2 text-xs text-blue-600 underline"
              >
                Suggerito: €{suggerito}
              </button>
            )}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.importo_totale}
            onChange={(e) => set('importo_totale', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tassa di soggiorno (€)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.tassa_soggiorno}
            onChange={(e) => set('tassa_soggiorno', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="0"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
        <textarea
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          rows={2}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onAnnulla}
          className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
        >
          Annulla
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Salva
        </button>
      </div>
    </form>
  );
}
