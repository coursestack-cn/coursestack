export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ENV: string;
  PUBLIC_ORIGIN?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
}