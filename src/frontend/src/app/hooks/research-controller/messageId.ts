let messageCounter = 0;

export function nextMessageId(prefix: string): string {
    messageCounter += 1;
    return `${prefix}-${Date.now()}-${messageCounter}`;
}
