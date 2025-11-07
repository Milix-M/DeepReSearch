import { API_BASE_URL } from '../env';
import type {
    HealthResponse,
    ThreadListResponse,
    ThreadStateResponse,
} from '../types/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        cache: 'no-store',
        ...init,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = body ? `${response.status} ${response.statusText}: ${body}` : `${response.status} ${response.statusText}`;
        throw new Error(`API request failed for ${path}: ${message}`);
    }

    return response.json() as Promise<T>;
}

export const apiClient = {
    health(): Promise<HealthResponse> {
        return request<HealthResponse>('/healthz');
    },
    listThreads(): Promise<ThreadListResponse> {
        return request<ThreadListResponse>('/threads');
    },
    getThreadState(threadId: string): Promise<ThreadStateResponse> {
        return request<ThreadStateResponse>(`/threads/${encodeURIComponent(threadId)}/state`);
    },
};
