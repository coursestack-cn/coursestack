export interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    APP_ENV: string;
    INTERNAL_API_TOKEN?: string;
}