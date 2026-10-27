import { onMount } from "svelte";

let currentTime = $state(Date.now());
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const clock = { get now() { return currentTime; } };

/** Every mounted RelativeTime shares one minute timer; the last unmount clears it. */
export function useRelativeClock(): typeof clock {
    onMount(() => {
        if (consumers === 0) {
            currentTime = Date.now();
            timer = setInterval(() => { currentTime = Date.now(); }, 60_000);
        }
        consumers += 1;
        return () => {
            consumers -= 1;
            if (consumers === 0 && timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
        };
    });
    return clock;
}