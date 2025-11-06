export interface InterruptPayload {
    id: string;
    value: unknown;
}

export interface HealthResponse {
    status: 'ok';
    timestamp: string;
    details: {
        active_threads: number;
        pending_interrupts: number;
        recursion_limit: number;
        [key: string]: unknown;
    };
}

export interface ThreadListResponse {
    active_thread_ids: string[];
    pending_interrupt_ids: string[];
    active_count: number;
    pending_count: number;
}

export interface ThreadStateResponse {
    thread_id: string;
    status: string;
    state: Record<string, unknown>;
    pending_interrupt: InterruptPayload | null;
}

export type WebSocketMessage =
    | { type: 'thread_started'; thread_id: string }
    | { type: 'event'; thread_id: string; payload: Record<string, unknown> }
    | { type: 'interrupt'; thread_id: string; interrupt: InterruptPayload }
    | { type: 'complete'; thread_id: string; state: Record<string, unknown> }
    | { type: 'error'; message: string; thread_id?: string };

export interface ResearchStartCommand {
    query: string;
}

export interface ResearchResumeCommand {
    decision: 'y' | 'n';
    plan?: unknown;
}
