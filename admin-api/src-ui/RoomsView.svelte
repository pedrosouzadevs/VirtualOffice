<script lang="ts">
    import { onMount } from "svelte";
    import AreasView from "./AreasView.svelte";
    import * as api from "./lib/api";
    import type { Room } from "./lib/api";
    import { t } from "./lib/i18n";

    let rooms = $state<Room[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    /**
     * The map whose areas are being looked at.
     *
     * The list of maps is the index, not the destination: what an administrator comes here for is what is drawn
     * inside one — the personal desks, the silent zones, the meeting spots, and who owns them.
     */
    let opened = $state<Room | null>(null);

    /**
     * Where a room lives for a person clicking it.
     *
     * `play` is reached at the same host with the service name swapped, the way `map-storage`'s own UI derives it.
     * Not perfect, and deliberately not fatal: a wrong guess produces a link that does not resolve, never a broken
     * screen.
     */
    const playOrigin = $derived(
        typeof window === "undefined"
            ? ""
            : `${window.location.protocol}//${window.location.host.replace("admin-api.", "play.").replace("admin-api-", "play-")}`,
    );

    async function load(): Promise<void> {
        loading = true;
        try {
            rooms = await api.listRooms();
            error = null;
        } catch (cause) {
            // The two failures mean different things: one is somebody else's outage, the other is a setting nobody
            // filled in, and telling an operator to restart map-storage when the URL was never set wastes their time.
            error =
                cause instanceof api.ApiError && cause.code === "ADMIN_ROOMS_NOT_CONFIGURED"
                    ? t.roomsNotConfigured
                    : t.roomsUnavailable;
        } finally {
            loading = false;
        }
    }

    onMount(() => void load());
</script>

{#if opened !== null}
    <AreasView room={opened} onBack={() => (opened = null)} />
{:else}
    {#if error !== null}
        <div class="banner error" role="alert">
            <span>{error}</span>
            <button onclick={() => void load()}>{t.refresh}</button>
        </div>
    {/if}

    {#if loading}
        <div class="empty-state">{t.loading}</div>
    {:else if rooms.length === 0 && error === null}
        <div class="empty-state">{t.noRooms}</div>
    {:else if rooms.length > 0}
        <table>
            <thead>
                <tr>
                    <th>{t.columnRoom}</th>
                    <th>{t.columnAddress}</th>
                    <th>{t.columnActions}</th>
                </tr>
            </thead>
            <tbody>
                {#each rooms as room (room.path)}
                    <tr>
                        <td>
                            <div>{room.name}</div>
                            {#if room.description}
                                <div class="name">{room.description}</div>
                            {/if}
                        </td>
                        <td><div class="email">{room.roomUrl}</div></td>
                        <td>
                            <div class="row-actions">
                                <button class="primary" onclick={() => (opened = room)}>{t.viewAreas}</button>
                                <!-- rel is not optional on a target=_blank link: without it the opened page can
                                     reach back through window.opener. -->
                                <a
                                    class="link-button"
                                    href={`${playOrigin}${room.roomUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer">{t.openRoom}</a
                                >
                            </div>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
{/if}

<style>
    /* Styled as a button because it acts like one, while staying an anchor so it can be opened in a new tab. */
    .link-button {
        display: inline-block;
        font: inherit;
        text-decoration: none;
        border-radius: 0.375rem;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0.35rem 0.7rem;
    }

    .link-button:hover {
        border-color: var(--accent);
    }
</style>
