const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_WS_URL = 'ws://127.0.0.1:8000/ws/research';

function resolveEnv(key: string, fallback: string): string {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }
    if (process.env.NODE_ENV === 'development') {
        console.warn(
            `[env] ${key} is not set. Falling back to ${fallback}. ` +
            'Define this variable in .env.local to match your deployment environment.'
        );
    }
    return fallback;
}

export const API_BASE_URL = resolveEnv(
    'NEXT_PUBLIC_API_BASE_URL',
    DEFAULT_API_BASE_URL
);

export const WS_URL = resolveEnv('NEXT_PUBLIC_WS_URL', DEFAULT_WS_URL);
