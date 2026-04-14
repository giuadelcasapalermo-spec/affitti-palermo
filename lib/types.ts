export interface Camera {
  id: number;
  nome: string;
  prezzo_notte: number;
}

export interface Prenotazione {
  id: string;
  camera_id: number;
  ospite_nome: string;
  ospite_telefono: string;
  ospite_email: string;
  check_in: string;
  check_out: string;
  importo_totale: number;
  tassa_soggiorno?: number;
  stato: 'confermata' | 'pending' | 'cancellata';
  note: string;
  created_at: string;
  fonte: 'manuale' | 'ical';
  ical_uid?: string;
}

export const CATEGORIE_USCITA = [
  'Pulizie',
  'Utenze',
  'Manutenzione',
  'Forniture',
  'Arredamento',
  'Commissioni',
  'Tasse',
  'Pubblicità',
  'Affitto',
  'Altro',
] as const;

export type CategoriaUscita = typeof CATEGORIE_USCITA[number];

export interface Uscita {
  id: string;
  data: string;
  descrizione: string;
  categoria: CategoriaUscita;
  importo: number;
  camera_id?: number;
  note: string;
  created_at: string;
}

export const CATEGORIE_ENTRATA = [
  'Booking.com',
  'Airbnb',
  'Privato',
  'Altro',
] as const;

export type CategoriaEntrata = typeof CATEGORIE_ENTRATA[number];

export interface Entrata {
  id: string;
  data: string;
  descrizione: string;
  categoria: CategoriaEntrata;
  importo: number;
  camera_id?: number;
  note: string;
  created_at: string;
}

export interface Impostazioni {
  ical_urls: Record<number, string>; // camera_id -> URL
  nomi_camere: Record<number, string>; // camera_id -> nome personalizzato
  ultimo_sync?: string;
}

export const CAMERE: Camera[] = [
  { id: 3, nome: 'Camera 3', prezzo_notte: 65 },
  { id: 2, nome: 'Camera 2', prezzo_notte: 60 },
  { id: 4, nome: 'Camera 4', prezzo_notte: 65 },
  { id: 1, nome: 'Camera 1', prezzo_notte: 60 },
  { id: 5, nome: 'Camera 5', prezzo_notte: 70 },
];
