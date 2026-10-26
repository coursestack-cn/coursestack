export type ToastTone = "success" | "error" | "info";
export type ToastAction = { label: string; onclick: () => void };
export type ToastOptions = { action?: ToastAction };
export type ToastMessage = ToastOptions & { id: number; tone: ToastTone; message: string };

let messages = $state<ToastMessage[]>([]);
let nextId = 0;

const visibleLimit = 3;

function add(tone: ToastTone, message: string, options: ToastOptions = {}): number {
    const id = ++nextId;
    messages = [...messages, { id, tone, message, ...options }];
    return id;
}

export const toast = {
    // Waiting messages start their timers only when Toaster mounts them.
    get messages(): readonly ToastMessage[] { return messages.slice(0, visibleLimit); },
    success: (message: string, options?: ToastOptions) => add("success", message, options),
    error: (message: string, options?: ToastOptions) => add("error", message, options),
    info: (message: string, options?: ToastOptions) => add("info", message, options),
    dismiss(id: number) { messages = messages.filter((message) => message.id !== id); },
    clear() { messages = []; }
};