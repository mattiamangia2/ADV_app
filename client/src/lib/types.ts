export type Company = { id: number; name: string; contact_email?: string; color?: string; billboard_count?: number };

export type CampaignTiming = { state: 'upcoming' | 'running' | 'ended'; duration_days: number; elapsed_days: number; remaining_days: number; progress: number };

export type Campaign = {
  id: number; billboard_id: number; advertiser: string; brand?: string; category?: string; title?: string;
  creative_url?: string; start_date: string; end_date: string; price_paid?: number; notes?: string; timing: CampaignTiming;
};

export type RouteFit = 'main flow' | 'secondary' | 'marginal' | 'off-route';

export type Metrics = {
  billboard_id: number; company_id: number; vehicles_per_day: number; people_per_day: number; avg_dwell_s: number;
  avg_speed_kmh: number | null; visibility_index: number; share_of_voice: number; impressions_per_day: number;
  impressions_per_month: number; cpm: number | null; hourly_people: number[]; peak_hour: number;
  traffic_percentile: number; route_fit: RouteFit;
};

export type Billboard = {
  id: number; company_id: number; code?: string; name: string; format: string; media_type: 'static' | 'digital';
  status: string; lat: number; lon: number; address?: string; city?: string; road_name?: string; road_type?: string;
  speed_limit_kmh?: number; facing_azimuth: number | null; viewing_angle_deg: number; visibility_m: number;
  height_above_ground_m?: number; width_m?: number; height_m?: number; surface_m2?: number; faces?: number;
  illuminated?: number; material?: string; resolution?: string; slot_seconds?: number; loop_seconds?: number;
  operating_hours?: string; currency?: string; price_week?: number; price_month?: number; price_year?: number;
  production_cost?: number; min_booking_days?: number; installed_at?: string; permit_number?: string;
  permit_expires_at?: string; photo_url?: string; notes?: string; extra: Record<string, unknown>;
  created_at?: string; updated_at?: string;
  current_campaign: Campaign | null; campaigns: Campaign[]; metrics: Partial<Metrics>; sample_trip_ids?: number[];
};

export type FormatDef = { label: string; media_type: string; width_m: number; height_m: number; visibility_m: number };
export type Meta = { formats: Record<string, FormatDef>; statuses: string[]; roadTypes: string[]; categories: string[]; fields: string[] };

export type Trip = { id: number; weight: number; vehicle_type: string; started_at: string; distance_m: number; path: [number, number, number][] };

export type Summary = {
  days: number; vehicle_trips_per_day: number; reached_trips_per_day: number; reach_pct: number; avg_frequency: number;
  billboards: number; digital: number; surface_m2: number; occupancy_pct: number; running_campaigns: number;
  monthly_list_price: number; impressions_per_month: number; avg_cpm: number | null; off_route: number; expiring_30d: number;
};

export type Gap = { lat: number; lon: number; vehicles_per_day: number };
export type Flow = { from: [number, number]; to: [number, number]; count: number; per_day: number };
