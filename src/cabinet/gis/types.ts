export type JobStatus = 'queued' | 'running' | 'done' | 'stopped' | 'error';

export interface GisRecord {
  name: string;
  description: string | null;
  rubrics: string[];
  address: string | null;
  city: string | null;
  rating: number | null;
  review_count: number | null;
  contacts: Record<string, string>;
  url: string | null;
  district: string | null;
}

export interface JobView {
  id: string;
  kind: 'parse' | 'yandex' | 'merge';
  status: JobStatus;
  error: string | null;
  createdAt: string;
  count: number;
  preview: boolean;
  urls: string[];
  queuePosition: number;
  teaser: GisRecord[];
}

export interface JobPoll extends JobView {
  logs: string[];
  cursor: number;
  savedLogs?: string[];
}

export interface JobList {
  items: JobView[];
  configured: boolean;
  limits: { maxRecords: number; maxUrls: number; previewRecords: number };
}

export interface Filters {
  dedup_across_niches: boolean;
  dedup_franchises: boolean;
  require_phone: boolean;
  require_whatsapp: boolean;
  require_social: boolean;
  require_email: boolean;
  require_website: boolean;
  require_no_website: boolean;
  min_rating: number;
  min_reviews: number;
}

export interface Advanced {
  disable_images: boolean;
  skip_404_response: boolean;
  add_rubrics: boolean;
  add_comments: boolean;
  remove_empty_columns: boolean;
  remove_duplicates: boolean;
  delay_between_clicks: number;
  columns_per_entity: number;
  encoding: string;
}

export interface Settings {
  max_records: number;
  clean: boolean;
  filters: Filters;
  advanced: Advanced;
}

export const DEFAULT_SETTINGS: Settings = {
  max_records: 50,
  clean: true,
  filters: {
    dedup_across_niches: true, dedup_franchises: false, require_phone: false, require_whatsapp: false, require_social: false,
    require_email: false, require_website: false, require_no_website: false, min_rating: 0, min_reviews: 0,
  },
  advanced: {
    disable_images: true, skip_404_response: true, add_rubrics: true, add_comments: true, remove_empty_columns: true,
    remove_duplicates: true, delay_between_clicks: 0, columns_per_entity: 3, encoding: 'utf-8-sig',
  },
};

export interface GenCity { n: string; c: string; d: string; k: string }
export interface GenRubric { c: string; l: string; r: number; n: number }
export interface GeneratorData {
  countries: { code: string; name: string }[];
  cities: GenCity[];
  rubrics: GenRubric[];
  districts: Record<string, string[]>;
}
