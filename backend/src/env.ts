export interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    APP_ENV: string;
    INTERNAL_API_TOKEN?: string;
    MATERIAL_MAX_BYTES?: string;
    R2_ACCOUNT_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
}