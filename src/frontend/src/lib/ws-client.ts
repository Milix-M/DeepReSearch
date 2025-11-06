import { WS_URL } from '../env';
import type {
    ResearchResumeCommand,
    ResearchStartCommand,
    WebSocketMessage,
} from '../types/api';

export interface ResearchSocketHandlers {
    onOpen?: (event: Event) => void;
    onMessage?: (message: WebSocketMessage) => void;
    onError?: (event: Event) => void;
    onClose?: (event: CloseEvent) => void;
}

function parseMessage(event: MessageEvent): WebSocketMessage | null {
    try {
        const payload = JSON.parse(event.data as string);
        return payload as WebSocketMessage;
    } catch (error) {
        console.error('[ws] Failed to parse message', error);
        return null;
    }
}

export function createResearchSocket(
    handlers: ResearchSocketHandlers = {}
): WebSocket {
    const socket = new WebSocket(WS_URL);

    if (handlers.onOpen) {
        socket.addEventListener('open', handlers.onOpen);
    }

    socket.addEventListener('message', (event) => {
        const message = parseMessage(event);
        if (message && handlers.onMessage) {
            handlers.onMessage(message);
        }
    });

    if (handlers.onError) {
        socket.addEventListener('error', handlers.onError);
    }

    if (handlers.onClose) {
        socket.addEventListener('close', handlers.onClose);
    }

    return socket;
}

function ensureOpen(socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket connection is not open. Wait for the open event before sending data.');
    }
}

export function sendStartCommand(
    socket: WebSocket,
    payload: ResearchStartCommand
): void {
    ensureOpen(socket);
    socket.send(JSON.stringify(payload));
}

export function sendResumeCommand(
    socket: WebSocket,
    payload: ResearchResumeCommand
): void {
    ensureOpen(socket);
    socket.send(JSON.stringify(payload));
}
