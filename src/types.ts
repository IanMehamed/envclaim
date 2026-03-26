export interface Environment {
  id: number;
  name: string;
  created_by: string;
  created_at: string;
}

export interface EnvironmentWithStatus extends Environment {
  reserved_by: string | null;
  reservation_id: number | null;
  reservation_started: string | null;
  reservation_expires: string | null;
  notes: string | null;
  waitlist_count: number;
  waitlist_users: string[];
  delegates: string[];
}

export interface Reservation {
  id: number;
  env_id: number;
  user_id: string;
  started_at: string;
  expires_at: string;
  notes: string | null;
  status: 'active' | 'expired' | 'released';
}

export interface ReservationWithEnv extends Reservation {
  env_name: string;
}

export interface WaitlistEntry {
  id: number;
  env_id: number;
  user_id: string;
  created_at: string;
}

export interface Admin {
  id: number;
  user_id: string;
  added_by: string;
  added_at: string;
}
