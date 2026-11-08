import { accountRoutes } from './accounts/routes.ts';
import { avatarRoutes } from './accounts/avatar.ts';
import { authRoutes } from './auth/routes.ts';
import type { Env } from './env.ts';

export type ManualTarget = { path: string; encodedId?: string; waitUntil: (work: Promise<unknown>) => void };
type Handler = (request: Request, env: Env, target: ManualTarget) => Promise<Response>;

export const manualRoutes: { path: string; methods: Record<string, Handler> }[] = [
    { path: '/api/auth/login', methods: { POST: authRoutes } },
    { path: '/api/auth/admin/login', methods: { POST: authRoutes } },
    { path: '/api/auth/logout', methods: { POST: authRoutes } },
    { path: '/api/auth/me', methods: { GET: authRoutes } },
    { path: '/api/auth/password', methods: { POST: authRoutes } },
    { path: '/api/admin/accounts', methods: { GET: accountRoutes, POST: authRoutes } },
    { path: '/api/admin/accounts/:id', methods: { GET: accountRoutes, PATCH: accountRoutes, DELETE: accountRoutes } },
    { path: '/api/admin/accounts/:id/password', methods: { POST: accountRoutes } },
    { path: '/api/me/profile', methods: { GET: accountRoutes, PATCH: accountRoutes } },
    { path: '/api/me/avatar', methods: { PUT: avatarRoutes, DELETE: avatarRoutes } },
    { path: '/api/profiles/:id', methods: { GET: accountRoutes } },
    { path: '/api/profiles/:id/avatar', methods: { GET: avatarRoutes } },
];

const patterns = manualRoutes.map(route => ({ route, pattern: new RegExp('^' + route.path.replace('/:id', '/([^/]+)') + '$') }));
export function matchManualRoute(pathname: string) {
    for (const { route, pattern } of patterns) {
        const match = pattern.exec(pathname);
        if (match) return { route, encodedId: match[1] };
    }
}